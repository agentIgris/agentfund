/**
 * routes/x402.ts — HTTP 402 "exact" payment flow for one-shot donations
 * (x402 spec: https://github.com/coinbase/x402). No `requireAuth` here —
 * the settled on-chain payment IS the authentication, which is the whole
 * point of the protocol.
 *
 * STAGE 1 (no X-PAYMENT header): reply 402 with a `PaymentRequirements`
 * envelope describing how to pay (escrow PDA, asset, and — if the caller
 * already told us who the fee payer will be — an unsigned `contribute` tx
 * ready to sign).
 *
 * STAGE 2 (X-PAYMENT header present): decode + verify the caller's
 * base64-JSON payment payload, confirm it actually funds *this* project's
 * escrow for at least the requested amount, broadcast it, and confirm.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Project } from "@prisma/client";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { prisma } from "../lib/prisma.js";
import { config } from "../config.js";
import { anchorSighash } from "../services/anchorEncoding.js";
import {
  buildContributeIx,
  buildUnsignedTransactionBase64,
  deriveEscrowPda,
  getConnection,
} from "../services/solana.js";
import { x402DonateBodySchema, x402PaymentHeaderSchema, x402ProjectParamSchema } from "../schema/x402.js";
import { createSvsX402Gate } from "../services/svsX402.js";

// Compute-budget instructions (priority fees / CU limits) may legitimately
// ride alongside the contribute instruction — same allowlist as tx.ts.
const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";

function allowedProgramIds(): Set<string> {
  const ids = [
    config.solana.escrowProgramId,
    config.solana.registryProgramId,
    config.solana.reputationProgramId,
  ].filter((id) => id.length > 0);
  return new Set([...ids, COMPUTE_BUDGET_PROGRAM_ID]);
}

// Anchor sighashes for the two instructions that can fund an escrow on a
// contributor's behalf (see services/solana.ts buildContributeIx /
// buildContributeForIx — both share the discriminator(8) + project
// pubkey(32) + amount u64 LE(8) layout).
const CONTRIBUTE_DISCRIMINATOR = anchorSighash("contribute");
const CONTRIBUTE_FOR_DISCRIMINATOR = anchorSighash("contribute_for");
const svsX402Gate = createSvsX402Gate({ settings: config.svs });

/** `process.env.X402_NETWORK ?? "solana-localnet"` — read fresh each call so tests can toggle it. */
function x402Network(): string {
  return process.env.X402_NETWORK ?? "solana-localnet";
}

/**
 * Builds the single `accepts` entry used both by the initial 402 challenge
 * and by a settlement-failure retry prompt. When `payer` is known we go
 * ahead and build the unsigned `contribute` transaction so the caller can
 * skip a round trip.
 */
async function buildPaymentRequirements(
  request: FastifyRequest,
  project: Project,
  amount: number,
  payer: string | undefined,
) {
  const [escrowPda] = deriveEscrowPda(new PublicKey(project.id));

  let unsignedTx: string | null = null;
  if (payer) {
    const payerPubkey = new PublicKey(payer);
    const ix = buildContributeIx({
      contributor: payerPubkey,
      project: new PublicKey(project.id),
      tokenMint: new PublicKey(project.tokenMint),
      amount,
    });
    unsignedTx = await buildUnsignedTransactionBase64([ix], payerPubkey);
  }

  return {
    scheme: "exact",
    network: x402Network(),
    maxAmountRequired: String(amount),
    resource: `${request.protocol}://${request.headers.host}${request.url}`,
    description: `Donation to "${project.title}" via AgentFund escrow`,
    mimeType: "application/json",
    payTo: escrowPda.toBase58(),
    maxTimeoutSeconds: 60,
    asset: project.tokenMint,
    extra: {
      projectId: project.id,
      feePayer: payer ?? null,
      unsignedTx,
    },
  };
}

/** `getLatestBlockhash` + `confirmTransaction`, capped at 60s like the on-chain test harness does. */
async function confirmWithTimeout(conn: Connection, signature: string): Promise<void> {
  const latest = await conn.getLatestBlockhash("confirmed");
  const confirmation = await Promise.race([
    conn.confirmTransaction({ signature, ...latest }, "confirmed"),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("confirmation timed out after 60s")), 60_000),
    ),
  ]);
  if (confirmation.value.err) {
    throw new Error(`transaction failed on-chain: ${JSON.stringify(confirmation.value.err)}`);
  }
}

export function registerX402Routes(app: FastifyInstance): void {
  app.post("/x402/donate/:projectId", async (request, reply) => {
    const paramsParsed = x402ProjectParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: paramsParsed.error.flatten() });
    }
    const bodyParsed = x402DonateBodySchema.safeParse(request.body);
    if (!bodyParsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: bodyParsed.error.flatten() });
    }
    const { projectId } = paramsParsed.data;
    const { amount, payer } = bodyParsed.data;

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return reply.code(404).send({ error: "project_not_found" });
    if (project.status !== "Active") return reply.code(400).send({ error: "project_not_active" });

    const paymentHeader = request.headers["x-payment"];

    // ── STAGE 1 — no payment offered yet: describe how to pay ──────────
    if (typeof paymentHeader !== "string") {
      const accepts = await buildPaymentRequirements(request, project, amount, payer);
      return reply.code(402).send({
        x402Version: 1,
        error: "X-PAYMENT header is required",
        accepts: [accepts],
      });
    }

    // ── STAGE 2 — verify the submitted payment ──────────────────────────

    // (a) header decodes to JSON matching the exact-scheme envelope.
    let paymentPayload: {
      scheme: string;
      payload: { signedTx: string };
      svs?: { actionRecordId: string; botId: string };
    };
    try {
      const decoded = Buffer.from(paymentHeader, "base64").toString("utf8");
      const json: unknown = JSON.parse(decoded);
      const parsed = x402PaymentHeaderSchema.safeParse(json);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_payment", message: "X-PAYMENT header failed schema validation" });
      }
      paymentPayload = parsed.data;
    } catch {
      return reply.code(400).send({ error: "invalid_payment", message: "X-PAYMENT header is not valid base64-encoded JSON" });
    }
    if (paymentPayload.scheme !== "exact") {
      return reply.code(400).send({
        error: "invalid_payment",
        message: `unsupported x402 scheme "${paymentPayload.scheme}"`,
      });
    }

    // (b) signedTx deserializes and every signature it carries checks out.
    let raw: Buffer;
    let tx: Transaction;
    try {
      raw = Buffer.from(paymentPayload.payload.signedTx, "base64");
      tx = Transaction.from(raw);
    } catch {
      return reply.code(400).send({ error: "invalid_payment", message: "payload.signedTx does not deserialize to a Solana transaction" });
    }
    if (!tx.verifySignatures()) {
      return reply.code(400).send({ error: "invalid_payment", message: "transaction signature verification failed" });
    }

    // (c) not an open relay: every instruction must target one of our own programs.
    const allowed = allowedProgramIds();
    const foreign = tx.instructions.find((ix) => !allowed.has(ix.programId.toBase58()));
    if (foreign) {
      return reply.code(400).send({
        error: "invalid_payment",
        message: `instruction targets disallowed program ${foreign.programId.toBase58()}`,
      });
    }

    // (d) exactly one instruction actually funds an escrow (contribute or contribute_for).
    const escrowProgramId = config.solana.escrowProgramId;
    const contributeIxs = tx.instructions.filter((ix) => {
      if (ix.programId.toBase58() !== escrowProgramId) return false;
      if (ix.data.length < 8) return false;
      const disc = ix.data.subarray(0, 8);
      return disc.equals(CONTRIBUTE_DISCRIMINATOR) || disc.equals(CONTRIBUTE_FOR_DISCRIMINATOR);
    });
    if (contributeIxs.length !== 1) {
      return reply.code(400).send({
        error: "invalid_payment",
        message: `expected exactly one contribute/contribute_for instruction, found ${contributeIxs.length}`,
      });
    }
    const contributeIx = contributeIxs[0]!;

    // (e) decode discriminator(8) + project pubkey(32) + amount u64 LE(8).
    if (contributeIx.data.length < 8 + 32 + 8) {
      return reply.code(400).send({ error: "invalid_payment", message: "contribute instruction data is truncated" });
    }
    const decodedProject = new PublicKey(contributeIx.data.subarray(8, 40)).toBase58();
    const decodedAmount = contributeIx.data.readBigUInt64LE(40);
    if (decodedProject !== project.id) {
      return reply.code(400).send({ error: "invalid_payment", message: "contribute instruction targets a different project" });
    }
    if (decodedAmount < BigInt(amount)) {
      return reply.code(400).send({ error: "invalid_payment", message: "contribute instruction amount is less than the requested amount" });
    }

    // (f) the escrow account (keys[0]) must be this project's derived PDA.
    const [escrowPda] = deriveEscrowPda(new PublicKey(project.id));
    const escrowAccountKey = contributeIx.keys[0]?.pubkey;
    if (!escrowAccountKey || !escrowAccountKey.equals(escrowPda)) {
      return reply.code(400).send({ error: "invalid_payment", message: "contribute instruction's escrow account does not match the derived PDA" });
    }

    // (g) when enabled, AgentFund fails closed unless SVS authorizes this exact
    // transaction, agent, intent, policy, simulation, fee, and wallet approval.
    const agentWallet = tx.feePayer?.toBase58();
    const action = contributeIx.data.subarray(0, 8).equals(CONTRIBUTE_DISCRIMINATOR)
      ? "x402_contribute" as const
      : "x402_contribute_for" as const;
    let svsAuthorization = null;

    if (svsX402Gate.enabled) {
      if (!paymentPayload.svs || !agentWallet) {
        return reply.code(403).send({
          error: "svs_authorization_required",
          message: "SVS actionRecordId, botId, and a transaction fee payer are required before settlement.",
        });
      }

      try {
        svsAuthorization = await svsX402Gate.requireAuthorization({
          actionRecordId: paymentPayload.svs.actionRecordId,
          botId: paymentPayload.svs.botId,
          agentWallet,
          action,
          projectId: project.id,
          amountMicroUsdc: decodedAmount.toString(),
          escrowPda: escrowPda.toBase58(),
          serializedTransaction: paymentPayload.payload.signedTx,
        });
      } catch (err) {
        request.log.warn({ err, actionRecordId: paymentPayload.svs.actionRecordId }, "x402/donate: SVS authorization rejected");
        return reply.code(403).send({
          error: "svs_authorization_failed",
          message: "SVS rejected this action. Do not broadcast until the action has current authorization for these exact transaction bytes.",
          actionRecordId: paymentPayload.svs.actionRecordId,
        });
      }
    }

    // ── Settlement — broadcast + confirm ────────────────────────────────
    const conn = getConnection();
    let signature: string;
    try {
      signature = await conn.sendRawTransaction(raw, { skipPreflight: false });
      await confirmWithTimeout(conn, signature);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      request.log.error({ err }, "x402/donate: settlement failed");
      const accepts = await buildPaymentRequirements(request, project, amount, payer);
      return reply.code(402).send({
        x402Version: 1,
        error: `settlement failed: ${message}`,
        accepts: [accepts],
      });
    }

    const responseHeader = Buffer.from(
      JSON.stringify({
        success: true,
        transaction: signature,
        network: x402Network(),
        payer: agentWallet ?? null,
      }),
    ).toString("base64");
    reply.header("X-PAYMENT-RESPONSE", responseHeader);

    if (svsX402Gate.enabled && paymentPayload.svs) {
      try {
        const evidence = await svsX402Gate.reportBroadcast(paymentPayload.svs.actionRecordId, signature);
        return reply.send({
          success: true,
          signature,
          projectId: project.id,
          amount: String(decodedAmount),
          svs: {
            status: "verified",
            actionRecordId: paymentPayload.svs.actionRecordId,
            authorizationHash: svsAuthorization?.authorization.verificationHash ?? null,
            evidence,
          },
        });
      } catch (err) {
        request.log.error({ err, signature, actionRecordId: paymentPayload.svs.actionRecordId }, "x402/donate: settled but SVS evidence report is pending");
        return reply.code(202).send({
          success: true,
          signature,
          projectId: project.id,
          amount: String(decodedAmount),
          svs: {
            status: "evidence_pending",
            actionRecordId: paymentPayload.svs.actionRecordId,
            authorizationHash: svsAuthorization?.authorization.verificationHash ?? null,
            message: "Payment is confirmed. Do not resubmit it; retry only the idempotent SVS evidence report.",
          },
        });
      }
    }

    return reply.send({
      success: true,
      signature,
      projectId: project.id,
      amount: String(decodedAmount),
    });
  });
}
