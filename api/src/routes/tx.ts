/**
 * routes/tx.ts — the build/send/status pattern that lets fully
 * autonomous agents sign transactions locally: `/tx/build/:action`
 * returns an unsigned, base64-encoded transaction with the calling
 * agent's wallet set as fee payer; the agent signs it with its own
 * keypair and submits the signed bytes to `/tx/send`; `/tx/:signature`
 * polls confirmation status.
 */
import type { FastifyInstance } from "fastify";
import { PublicKey, Transaction } from "@solana/web3.js";
import { NATIVE_SOL_MINT, resolveUsdcMint } from "@agentfund/shared";
import { prisma } from "../lib/prisma.js";
import { config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";

// Compute-budget instructions (priority fees / CU limits) are legitimately
// prepended by agents to otherwise-AgentFund-only transactions.
const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";

/** Program IDs a submitted transaction is allowed to touch (our three programs + compute budget). */
function allowedProgramIds(): Set<string> {
  const ids = [
    config.solana.registryProgramId,
    config.solana.escrowProgramId,
    config.solana.reputationProgramId,
  ].filter((id) => id.length > 0);
  return new Set([...ids, COMPUTE_BUDGET_PROGRAM_ID]);
}
import { getConnection, buildUnsignedTransactionBase64 } from "../services/solana.js";
import {
  buildContributeIx,
  buildCreateProjectIx,
  buildInitializeEscrowIx,
  buildRefundIx,
  buildRegisterAgentIx,
  buildReleaseMilestoneIx,
  buildVoteMilestoneIx,
  deriveProjectPda,
} from "../services/solana.js";
import { pinAgentMetadata, pinProjectMetadata } from "../services/ipfs.js";
import { txBuildBodySchemas, txBuildParamsSchema, txSendBodySchema, txSignatureParamSchema } from "../schema/tx.js";

function tokenToMint(token: "SOL" | "USDC"): string {
  return token === "SOL" ? NATIVE_SOL_MINT : resolveUsdcMint();
}

export function registerTxRoutes(app: FastifyInstance): void {
  app.post("/tx/build/:action", { preHandler: requireAuth }, async (request, reply) => {
    const paramsParsed = txBuildParamsSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({ error: "invalid_action" });
    }
    const { action } = paramsParsed.data;
    const feePayer = new PublicKey(request.agentWallet!);

    switch (action) {
      case "register_agent": {
        const parsed = txBuildBodySchemas.register_agent.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
        const body = parsed.data;
        const metadataUri =
          body.metadataUri ??
          (await pinAgentMetadata({ name: body.name, description: body.description, avatar: body.avatar }));
        const ix = buildRegisterAgentIx({ owner: feePayer, metadataUri });
        const unsignedTx = await buildUnsignedTransactionBase64([ix], feePayer);
        return reply.send({ unsignedTx });
      }

      case "create_project": {
        const parsed = txBuildBodySchemas.create_project.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
        const body = parsed.data;

        const agent = await prisma.agent.findUnique({ where: { owner: feePayer.toBase58() } });
        if (!agent) {
          return reply.code(409).send({
            error: "agent_not_registered",
            message: "Register this wallet via /tx/build/register_agent first.",
          });
        }

        const ipfsHash = await pinProjectMetadata({
          title: body.title,
          description: body.description,
          image: body.image,
          category: body.category,
          founderNote: body.founderNote,
        });
        const projectIndex = agent.projectsCreated;
        const tokenMint = new PublicKey(tokenToMint(body.token));
        const ix = buildCreateProjectIx({
          creator: feePayer,
          projectIndex,
          ipfsHash,
          goalAmount: body.goalAmount,
          tokenMint,
          deadline: body.deadline,
          milestoneCount: body.milestones.length,
        });
        const [projectPda] = deriveProjectPda(feePayer, projectIndex);
        // Finding #9: the escrow init rides in the SAME transaction as
        // create_project, so the [ESCROW_SEED, project] slot is claimed
        // atomically by the creator with terms identical to the project's —
        // no window for a third party to front-run it with mismatched terms.
        const escrowIx = buildInitializeEscrowIx({
          payer: feePayer,
          creator: feePayer,
          project: projectPda,
          goalAmount: body.goalAmount,
          deadline: body.deadline,
          milestoneCount: body.milestones.length,
          tokenMint,
        });
        const unsignedTx = await buildUnsignedTransactionBase64([ix, escrowIx], feePayer);
        return reply.send({ unsignedTx, projectId: projectPda.toBase58() });
      }

      case "initialize_escrow": {
        const parsed = txBuildBodySchemas.initialize_escrow.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
        const body = parsed.data;
        const project = await prisma.project.findUnique({ where: { id: body.projectId } });
        if (!project) return reply.code(404).send({ error: "project_not_found" });
        // The program binds escrow.creator to the `creator` signer, and the
        // fee payer is the only signer of API-built transactions — so only
        // the project's creator may claim its escrow slot, with terms taken
        // from the indexed project record rather than the request body.
        if (project.creator !== feePayer.toBase58()) {
          return reply.code(403).send({ error: "not_project_creator" });
        }
        const ix = buildInitializeEscrowIx({
          payer: feePayer,
          creator: feePayer,
          project: new PublicKey(project.id),
          goalAmount: project.goalAmount,
          deadline: project.deadline,
          milestoneCount: project.milestoneCount,
          tokenMint: new PublicKey(project.tokenMint),
        });
        const unsignedTx = await buildUnsignedTransactionBase64([ix], feePayer);
        return reply.send({ unsignedTx });
      }

      case "contribute": {
        const parsed = txBuildBodySchemas.contribute.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
        const body = parsed.data;
        const project = await prisma.project.findUnique({ where: { id: body.projectId } });
        if (!project) return reply.code(404).send({ error: "project_not_found" });
        const ix = buildContributeIx({
          contributor: feePayer,
          project: new PublicKey(project.id),
          tokenMint: new PublicKey(project.tokenMint),
          amount: body.amount,
        });
        const unsignedTx = await buildUnsignedTransactionBase64([ix], feePayer);
        return reply.send({ unsignedTx });
      }

      case "vote": {
        const parsed = txBuildBodySchemas.vote.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
        const body = parsed.data;
        const project = await prisma.project.findUnique({ where: { id: body.projectId } });
        if (!project) return reply.code(404).send({ error: "project_not_found" });
        const ix = buildVoteMilestoneIx({
          voter: feePayer,
          project: new PublicKey(project.id),
          milestoneIndex: body.milestoneIndex,
          support: body.support,
        });
        const unsignedTx = await buildUnsignedTransactionBase64([ix], feePayer);
        return reply.send({ unsignedTx });
      }

      case "release_milestone": {
        const parsed = txBuildBodySchemas.release_milestone.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
        const body = parsed.data;
        const project = await prisma.project.findUnique({ where: { id: body.projectId } });
        if (!project) return reply.code(404).send({ error: "project_not_found" });
        const ix = buildReleaseMilestoneIx({
          payer: feePayer,
          project: new PublicKey(project.id),
          creator: new PublicKey(project.creator),
          tokenMint: new PublicKey(project.tokenMint),
          milestoneIndex: body.milestoneIndex,
          voteAccounts: body.voteAccounts?.map((v) => new PublicKey(v)),
        });
        const unsignedTx = await buildUnsignedTransactionBase64([ix], feePayer);
        return reply.send({ unsignedTx });
      }

      case "refund": {
        const parsed = txBuildBodySchemas.refund.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
        const body = parsed.data;
        const project = await prisma.project.findUnique({ where: { id: body.projectId } });
        if (!project) return reply.code(404).send({ error: "project_not_found" });
        const ix = buildRefundIx({
          contributor: feePayer,
          project: new PublicKey(project.id),
          tokenMint: new PublicKey(project.tokenMint),
        });
        const unsignedTx = await buildUnsignedTransactionBase64([ix], feePayer);
        return reply.send({ unsignedTx });
      }

      default: {
        const _exhaustive: never = action;
        return reply.code(400).send({ error: "unsupported_action" });
      }
    }
  });

  app.post("/tx/send", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = txSendBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });

    const conn = getConnection();
    let raw: Buffer;
    try {
      raw = Buffer.from(parsed.data.signedTx, "base64");
    } catch {
      return reply.code(400).send({ error: "invalid_base64" });
    }

    let tx: Transaction;
    try {
      tx = Transaction.from(raw);
    } catch {
      return reply.code(400).send({ error: "invalid_transaction" });
    }

    // Not an open relay: only broadcast transactions whose every instruction
    // targets one of AgentFund's own programs (+ compute budget). Otherwise the
    // endpoint would let any authed wallet push arbitrary traffic through the
    // operator's RPC. When no program IDs are configured (local bootstrap) we
    // skip the check but warn — production always has them set.
    const allowed = allowedProgramIds();
    if (allowed.size > 1) {
      const foreign = tx.instructions.find((ix) => !allowed.has(ix.programId.toBase58()));
      if (foreign) {
        return reply.code(400).send({
          error: "disallowed_program",
          message: `Transaction touches non-AgentFund program ${foreign.programId.toBase58()}.`,
        });
      }
    } else {
      request.log.warn("tx/send: program IDs unconfigured, skipping program allowlist check");
    }

    try {
      const signature = await conn.sendRawTransaction(raw, { skipPreflight: false });
      request.log.info({ signature, wallet: request.agentWallet }, "tx/send: broadcast");
      return reply.send({ signature });
    } catch (err) {
      request.log.error({ err }, "tx/send: broadcast failed");
      return reply.code(400).send({ error: "send_failed", message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/tx/:signature", async (request, reply) => {
    const parsed = txSignatureParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    const conn = getConnection();
    const { value } = await conn.getSignatureStatuses([parsed.data.signature]);
    const status = value[0];

    if (!status) {
      return reply.send({ signature: parsed.data.signature, confirmed: false });
    }

    return reply.send({
      signature: parsed.data.signature,
      confirmed:
        status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized",
      slot: status.slot,
      err: status.err ? JSON.stringify(status.err) : null,
    });
  });
}
