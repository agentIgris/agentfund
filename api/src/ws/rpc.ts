/**
 * ws/rpc.ts — RPC-over-WebSocket handlers for the 3 methods in the spec
 * (`projects.list`, `projects.create`, `tx.build`). Bidirectional: these
 * run over the same persistent socket used for channel subscriptions.
 */
import { PublicKey } from "@solana/web3.js";
import { NATIVE_SOL_MINT, resolveUsdcMint, type WsRpcMethod } from "@agentfund/shared";
import { prisma } from "../lib/prisma.js";
import { serializeBigInts } from "../lib/serialize.js";
import { pinProjectMetadata } from "../services/ipfs.js";
import {
  buildContributeIx,
  buildCreateProjectIx,
  buildRefundIx,
  buildRegisterAgentIx,
  buildReleaseMilestoneIx,
  buildUnsignedTransactionBase64,
  buildVoteMilestoneIx,
  deriveProjectPda,
} from "../services/solana.js";
import { pinAgentMetadata } from "../services/ipfs.js";
import { listProjectsQuerySchema } from "../schema/projects.js";
import { txActionSchema, txBuildBodySchemas } from "../schema/tx.js";

export class RpcError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export interface RpcContext {
  /** Authenticated wallet, if the socket has completed the `auth` handshake. */
  wallet?: string;
}

function tokenToMint(token: "SOL" | "USDC"): string {
  return token === "SOL" ? NATIVE_SOL_MINT : resolveUsdcMint();
}

function requireWallet(ctx: RpcContext): PublicKey {
  if (!ctx.wallet) throw new RpcError("unauthorized", "This RPC method requires an authenticated socket (send an `auth` message first)");
  return new PublicKey(ctx.wallet);
}

async function projectsList(params: unknown) {
  const parsed = listProjectsQuerySchema.safeParse(params ?? {});
  if (!parsed.success) throw new RpcError("invalid_params", parsed.error.message);
  const { status, token, minGoal, category, sort, limit, offset } = parsed.data;

  const orderBy =
    sort === "oldest"
      ? { createdAt: "asc" as const }
      : sort === "goal"
        ? { goalAmount: "desc" as const }
        : sort === "raised"
          ? { raisedAmount: "desc" as const }
          : sort === "deadline"
            ? { deadline: "asc" as const }
            : { createdAt: "desc" as const };

  const projects = await prisma.project.findMany({
    where: {
      status,
      tokenMint: token ? tokenToMint(token) : undefined,
      goalAmount: minGoal ? { gte: BigInt(minGoal) } : undefined,
      category: category ?? undefined,
    },
    orderBy,
    take: limit,
    skip: offset,
  });
  return { projects: serializeBigInts(projects) };
}

async function projectsCreate(params: unknown, ctx: RpcContext) {
  const creator = requireWallet(ctx);
  const parsed = txBuildBodySchemas.create_project.safeParse(params);
  if (!parsed.success) throw new RpcError("invalid_params", parsed.error.message);
  const body = parsed.data;

  const agent = await prisma.agent.findUnique({ where: { owner: creator.toBase58() } });
  if (!agent) throw new RpcError("agent_not_registered", "Register this wallet first (tx.build register_agent)");

  const ipfsHash = await pinProjectMetadata({
    title: body.title,
    description: body.description,
    image: body.image,
    category: body.category,
  });
  const projectIndex = agent.projectsCreated;
  const ix = buildCreateProjectIx({
    creator,
    projectIndex,
    ipfsHash,
    goalAmount: body.goalAmount,
    tokenMint: new PublicKey(tokenToMint(body.token)),
    deadline: body.deadline,
    milestoneCount: body.milestones.length,
  });
  const unsignedTx = await buildUnsignedTransactionBase64([ix], creator);
  const [projectPda] = deriveProjectPda(creator, projectIndex);
  return { projectId: projectPda.toBase58(), unsignedTx };
}

async function txBuild(params: unknown, ctx: RpcContext) {
  const feePayer = requireWallet(ctx);
  const paramsObj = (params ?? {}) as { action?: string };
  const actionParsed = txActionSchema.safeParse(paramsObj.action);
  if (!actionParsed.success) throw new RpcError("invalid_params", "params.action must be one of the supported tx actions");
  const action = actionParsed.data;

  switch (action) {
    case "register_agent": {
      const parsed = txBuildBodySchemas.register_agent.safeParse(params);
      if (!parsed.success) throw new RpcError("invalid_params", parsed.error.message);
      const body = parsed.data;
      const metadataUri =
        body.metadataUri ?? (await pinAgentMetadata({ name: body.name, description: body.description, avatar: body.avatar }));
      const ix = buildRegisterAgentIx({ owner: feePayer, metadataUri });
      return { unsignedTx: await buildUnsignedTransactionBase64([ix], feePayer) };
    }
    case "create_project":
      return projectsCreate(params, ctx);
    case "contribute": {
      const parsed = txBuildBodySchemas.contribute.safeParse(params);
      if (!parsed.success) throw new RpcError("invalid_params", parsed.error.message);
      const project = await prisma.project.findUnique({ where: { id: parsed.data.projectId } });
      if (!project) throw new RpcError("not_found", "project not found");
      const ix = buildContributeIx({
        contributor: feePayer,
        project: new PublicKey(project.id),
        tokenMint: new PublicKey(project.tokenMint),
        amount: parsed.data.amount,
      });
      return { unsignedTx: await buildUnsignedTransactionBase64([ix], feePayer) };
    }
    case "vote": {
      const parsed = txBuildBodySchemas.vote.safeParse(params);
      if (!parsed.success) throw new RpcError("invalid_params", parsed.error.message);
      const project = await prisma.project.findUnique({ where: { id: parsed.data.projectId } });
      if (!project) throw new RpcError("not_found", "project not found");
      const ix = buildVoteMilestoneIx({
        voter: feePayer,
        project: new PublicKey(project.id),
        milestoneIndex: parsed.data.milestoneIndex,
        support: parsed.data.support,
      });
      return { unsignedTx: await buildUnsignedTransactionBase64([ix], feePayer) };
    }
    case "release_milestone": {
      const parsed = txBuildBodySchemas.release_milestone.safeParse(params);
      if (!parsed.success) throw new RpcError("invalid_params", parsed.error.message);
      const project = await prisma.project.findUnique({ where: { id: parsed.data.projectId } });
      if (!project) throw new RpcError("not_found", "project not found");
      const ix = buildReleaseMilestoneIx({
        payer: feePayer,
        project: new PublicKey(project.id),
        creator: new PublicKey(project.creator),
        tokenMint: new PublicKey(project.tokenMint),
        milestoneIndex: parsed.data.milestoneIndex,
        voteAccounts: parsed.data.voteAccounts?.map((v) => new PublicKey(v)),
      });
      return { unsignedTx: await buildUnsignedTransactionBase64([ix], feePayer) };
    }
    case "refund": {
      const parsed = txBuildBodySchemas.refund.safeParse(params);
      if (!parsed.success) throw new RpcError("invalid_params", parsed.error.message);
      const project = await prisma.project.findUnique({ where: { id: parsed.data.projectId } });
      if (!project) throw new RpcError("not_found", "project not found");
      const ix = buildRefundIx({
        contributor: feePayer,
        project: new PublicKey(project.id),
        tokenMint: new PublicKey(project.tokenMint),
      });
      return { unsignedTx: await buildUnsignedTransactionBase64([ix], feePayer) };
    }
  }
}

const HANDLERS: Record<WsRpcMethod, (params: unknown, ctx: RpcContext) => Promise<unknown>> = {
  "projects.list": (params) => projectsList(params),
  "projects.create": (params, ctx) => projectsCreate(params, ctx),
  "tx.build": (params, ctx) => txBuild(params, ctx),
};

export async function handleRpc(method: WsRpcMethod, params: unknown, ctx: RpcContext): Promise<unknown> {
  const handler = HANDLERS[method];
  if (!handler) throw new RpcError("unknown_method", `Unsupported RPC method: ${method}`);
  return handler(params, ctx);
}
