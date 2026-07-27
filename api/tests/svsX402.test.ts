import { describe, expect, it, vi } from "vitest";
import { wsServerEventSchema } from "@agentfund/shared";
import { emitContributionVerified } from "../src/services/contributionVerified.js";
import type { SettlementAuthorizationProvider } from "../src/services/settlementAuthorization.js";
import {
  createSvsSettlementAuthorizationProvider,
  type SvsX402Settings,
} from "../src/services/svsX402.js";

const settings: SvsX402Settings = {
  enforceX402: true,
  serverUrl: "https://app.svsprotocol.com",
  relayerBotId: "agentfund-relayer",
  apiKey: "test-api-key",
  requestSigningSecret: "test-signing-secret",
  policyId: "agentfund-x402-contribution-v1",
  approvalStaleAfterMs: 900_000,
  certificationStaleAfterMs: 86_400_000,
};

const input = {
  actionRecordId: "action-record-123",
  botId: "external-donor-agent",
  agentWallet: "DonorWallet11111111111111111111111111111111",
  action: "x402_contribute" as const,
  projectId: "Project1111111111111111111111111111111111",
  amountMicroUsdc: "500000",
  escrowPda: "Escrow1111111111111111111111111111111111",
  serializedTransaction: "c2lnbmVkLXRyYW5zYWN0aW9u",
};

describe("createSvsSettlementAuthorizationProvider", () => {
  it("binds the exact AgentFund action and transaction before broadcast", async () => {
    const authorization = {
      ok: true,
      status: "authorized",
      authorization: { verificationHash: "a".repeat(64) },
    };
    const authorizeAction = vi.fn().mockResolvedValue(authorization);
    const request = vi.fn().mockResolvedValue({
      idempotentReplay: false,
      path: "/private/svs/queue/action-record-123.json",
      record: { privateOperatorField: "must-not-leak" },
      verification: {
        exactTransactionMatch: true,
        reporterBotId: settings.relayerBotId,
        actionBotId: input.botId,
        signature: "confirmed-signature",
        cluster: "devnet",
        confirmationStatus: "confirmed",
        slot: 123,
        expectedTransactionHash: "a".repeat(64),
        onChainTransactionHash: "a".repeat(64),
      },
    });
    const client = { request };
    const gate: SettlementAuthorizationProvider =
      createSvsSettlementAuthorizationProvider({ settings, client, authorizeAction });

    await expect(gate.requireAuthorization(input)).resolves.toEqual({
      providerId: "svs",
      actionRecordId: input.actionRecordId,
      botId: input.botId,
      authorizationHash: "a".repeat(64),
    });
    expect(authorizeAction).toHaveBeenCalledWith(expect.objectContaining({
      client,
      botId: input.botId,
      agentWallet: input.agentWallet,
      action: input.action,
      actionRecordId: input.actionRecordId,
      expectedIntent: {
        projectId: input.projectId,
        amountMicroUsdc: input.amountMicroUsdc,
        escrowPda: input.escrowPda,
      },
      expectedPolicyId: settings.policyId,
      expectedSerializedTransaction: input.serializedTransaction,
      requireCurrentIntegrationContract: true,
      requireTransactionBinding: true,
      requireSignedRequest: true,
      requireSuccessfulSimulation: true,
      requireConfirmedFeePayment: true,
    }));

    const evidence = await gate.reportBroadcast({
      actionRecordId: input.actionRecordId,
      signature: "confirmed-signature",
    });
    expect(request).toHaveBeenCalledWith(`/api/actions/${input.actionRecordId}/external-broadcast`, {
      method: "POST",
      body: { signature: "confirmed-signature" },
      requestSigningSecret: settings.requestSigningSecret,
      signRequest: true,
      retrySafe: true,
    });
    expect(evidence).toEqual({
      providerId: "svs",
      version: "agentfund.svs-x402-broadcast-evidence.v1",
      status: "verified",
      actionRecordId: input.actionRecordId,
      signature: "confirmed-signature",
      reporterBotId: settings.relayerBotId,
      actionBotId: input.botId,
      cluster: "devnet",
      confirmationStatus: "confirmed",
      slot: 123,
      expectedTransactionHash: "a".repeat(64),
      onChainTransactionHash: "a".repeat(64),
      exactTransactionMatch: true,
      idempotentReplay: false,
    });
    expect(JSON.stringify(evidence)).not.toContain("privateOperatorField");
    expect(JSON.stringify(evidence)).not.toContain("/private/svs/queue");
  });

  it("preserves the existing x402 flow when enforcement is disabled", async () => {
    const authorizeAction = vi.fn();
    const request = vi.fn();
    const gate = createSvsSettlementAuthorizationProvider({
      settings: { ...settings, enforceX402: false },
      client: { request },
      authorizeAction,
    });

    await expect(gate.requireAuthorization(input)).resolves.toBeNull();
    await expect(gate.reportBroadcast({
      actionRecordId: input.actionRecordId,
      signature: "signature",
    })).resolves.toBeNull();
    expect(authorizeAction).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects a broadcast report that is not bound to the configured relayer", async () => {
    const gate = createSvsSettlementAuthorizationProvider({
      settings,
      client: {
        request: vi.fn().mockResolvedValue({
          verification: {
            exactTransactionMatch: true,
            reporterBotId: "unexpected-relayer",
            signature: "signature",
            expectedTransactionHash: "a".repeat(64),
            onChainTransactionHash: "a".repeat(64),
          },
        }),
      },
      authorizeAction: vi.fn(),
    });

    await expect(gate.reportBroadcast({
      actionRecordId: input.actionRecordId,
      signature: "signature",
    }))
      .rejects.toThrow(/configured relayer/);
  });
});

describe("contribution.verified event", () => {
  it("publishes a typed internal event with the maintainer-requested fields", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const event = await emitContributionVerified({
      projectId: "11111111111111111111111111111111",
      botId: input.botId,
      actionRecordId: input.actionRecordId,
      signature: "confirmed-signature",
      authorizationHash: "a".repeat(64),
    }, publish);

    expect(wsServerEventSchema.parse(event)).toEqual(event);
    expect(publish).toHaveBeenCalledWith("contributions", event);
    expect(event).toEqual({
      type: "contribution.verified",
      data: {
        projectId: "11111111111111111111111111111111",
        botId: input.botId,
        actionRecordId: input.actionRecordId,
        signature: "confirmed-signature",
        authorizationHash: "a".repeat(64),
      },
    });
  });
});
