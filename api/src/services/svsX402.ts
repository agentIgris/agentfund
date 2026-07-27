import { SolanaVerificationClient } from "@svsprotocol/solana";
import {
  requireAuthorizedAction,
  type RequireAuthorizedActionOptions,
  type SvsAuthorizedActionRequirement,
} from "@svsprotocol/solana/protocol";
import type {
  SettlementAuthorizationDecision,
  SettlementAuthorizationInput,
  SettlementAuthorizationProvider,
  SettlementBroadcastEvidence,
  SettlementBroadcastInput,
} from "./settlementAuthorization.js";

export interface SvsX402Settings {
  enforceX402: boolean;
  serverUrl: string;
  relayerBotId: string;
  apiKey: string;
  requestSigningSecret: string;
  policyId: string;
  approvalStaleAfterMs: number;
  certificationStaleAfterMs: number;
}

export interface SvsX402BroadcastEvidence {
  version: "agentfund.svs-x402-broadcast-evidence.v1";
  status: "verified";
  actionRecordId: string;
  signature: string;
  reporterBotId: string;
  actionBotId: string | null;
  cluster: string | null;
  confirmationStatus: string | null;
  slot: number | null;
  expectedTransactionHash: string;
  onChainTransactionHash: string;
  exactTransactionMatch: true;
  idempotentReplay: boolean;
}

interface SvsX402Client {
  request(path: string, options: Record<string, unknown>): Promise<unknown>;
}

type AuthorizeAction = (
  options: RequireAuthorizedActionOptions,
) => Promise<SvsAuthorizedActionRequirement>;

export function createSvsSettlementAuthorizationProvider({
  settings,
  client,
  authorizeAction = requireAuthorizedAction,
}: {
  settings: SvsX402Settings;
  client?: SvsX402Client;
  authorizeAction?: AuthorizeAction;
}): SettlementAuthorizationProvider {
  const svsClient = client ?? (settings.enforceX402
    ? new SolanaVerificationClient({
        baseUrl: settings.serverUrl,
        apiKey: settings.apiKey,
        requestSigningSecret: settings.requestSigningSecret,
      })
    : null);

  return {
    id: "svs",
    enabled: settings.enforceX402,

    async requireAuthorization(
      input: SettlementAuthorizationInput,
    ): Promise<SettlementAuthorizationDecision | null> {
      if (!settings.enforceX402) return null;
      assertConfigured(settings);

      const authorization = await authorizeAction({
        client: svsClient,
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
        approvalStaleAfterMs: settings.approvalStaleAfterMs,
        certificationStaleAfterMs: settings.certificationStaleAfterMs,
        requireCurrentIntegrationContract: true,
        requireTransactionBinding: true,
        requireSignedRequest: true,
        requireSuccessfulSimulation: true,
        requireConfirmedFeePayment: true,
      });

      return {
        providerId: "svs",
        actionRecordId: input.actionRecordId,
        botId: input.botId,
        authorizationHash: authorization.authorization.verificationHash,
      };
    },

    async reportBroadcast(
      input: SettlementBroadcastInput,
    ): Promise<(SvsX402BroadcastEvidence & SettlementBroadcastEvidence) | null> {
      if (!settings.enforceX402) return null;
      assertConfigured(settings);
      const { actionRecordId, signature } = input;
      const result = await svsClient!.request(`/api/actions/${encodeURIComponent(actionRecordId)}/external-broadcast`, {
        method: "POST",
        body: { signature },
        requestSigningSecret: settings.requestSigningSecret,
        signRequest: true,
        retrySafe: true,
      });
      const response = isObject(result) ? result : null;
      const verification = response && isObject(response.verification)
        ? response.verification
        : null;

      if (
        verification?.exactTransactionMatch !== true ||
        verification.reporterBotId !== settings.relayerBotId ||
        verification.signature !== signature ||
        typeof verification.expectedTransactionHash !== "string" ||
        typeof verification.onChainTransactionHash !== "string" ||
        verification.expectedTransactionHash !== verification.onChainTransactionHash
      ) {
        throw new Error("SVS did not return an exact transaction match for the configured relayer.");
      }

      return {
        providerId: "svs",
        version: "agentfund.svs-x402-broadcast-evidence.v1",
        status: "verified",
        actionRecordId,
        signature,
        reporterBotId: settings.relayerBotId,
        actionBotId: typeof verification.actionBotId === "string" ? verification.actionBotId : null,
        cluster: typeof verification.cluster === "string" ? verification.cluster : null,
        confirmationStatus: typeof verification.confirmationStatus === "string"
          ? verification.confirmationStatus
          : null,
        slot: typeof verification.slot === "number" ? verification.slot : null,
        expectedTransactionHash: verification.expectedTransactionHash,
        onChainTransactionHash: verification.onChainTransactionHash,
        exactTransactionMatch: true,
        idempotentReplay: response?.idempotentReplay === true,
      };
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertConfigured(settings: SvsX402Settings): void {
  const missing = [
    ["SVS_SERVER_URL", settings.serverUrl],
    ["SVS_RELAYER_BOT_ID", settings.relayerBotId],
    ["SVS_RELAYER_API_KEY", settings.apiKey],
    ["SVS_RELAYER_REQUEST_SIGNING_SECRET", settings.requestSigningSecret],
    ["SVS_X402_POLICY_ID", settings.policyId],
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`SVS x402 enforcement is enabled but configuration is missing: ${missing.join(", ")}`);
  }
}
