/**
 * Zod schemas mirroring shared/src/types.ts. Used for request/response
 * validation across api, mcp, and acp workspaces. Keep in lockstep with
 * types.ts — every exported type there should have a corresponding
 * schema here (and vice versa).
 */
import { z } from "zod";

// ─────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────

export const projectStatusSchema = z.enum([
  "Active",
  "Funded",
  "Failed",
  "Complete",
]);

export const supportedTokenSchema = z.enum(["SOL", "USDC"]);

// Loose base58 pubkey check: 32-44 chars, base58 alphabet.
const base58PubkeySchema = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid base58 pubkey");

// ─────────────────────────────────────────────────────────────
// Core entities
// ─────────────────────────────────────────────────────────────

export const agentSchema = z.object({
  owner: base58PubkeySchema,
  metadataUri: z.string().url(),
  reputationScore: z.number().int().nonnegative(),
  projectsCreated: z.number().int().nonnegative(),
  totalContributed: z.number().int().nonnegative(),
  bump: z.number().int().min(0).max(255),
});

export const projectSchema = z.object({
  id: base58PubkeySchema,
  creator: base58PubkeySchema,
  ipfsHash: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  image: z.string().url().optional(),
  category: z.string().optional(),
  goalAmount: z.number().int().positive(),
  tokenMint: base58PubkeySchema,
  raisedAmount: z.number().int().nonnegative(),
  deadline: z.number().int().positive(),
  status: projectStatusSchema,
  milestoneCount: z.number().int().min(0).max(255),
  bump: z.number().int().min(0).max(255),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const milestoneSchema = z.object({
  project: base58PubkeySchema,
  index: z.number().int().min(0).max(255),
  description: z.string().min(1),
  amount: z.number().int().positive(),
  released: z.boolean(),
  votesFor: z.number().int().nonnegative(),
  votesAgainst: z.number().int().nonnegative(),
  releaseSig: z.string().optional(),
});

export const contributionSchema = z.object({
  contributor: base58PubkeySchema,
  project: base58PubkeySchema,
  amount: z.number().int().positive(),
  timestamp: z.number().int().positive(),
  bump: z.number().int().min(0).max(255),
  sig: z.string().optional(),
});

export const voteSchema = z.object({
  voter: base58PubkeySchema,
  project: base58PubkeySchema,
  milestoneIndex: z.number().int().min(0).max(255),
  support: z.boolean(),
  timestamp: z.number().int().positive(),
  bump: z.number().int().min(0).max(255),
  sig: z.string().optional(),
});

// ─────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────

export const authChallengeSchema = z.object({
  nonce: z.string().min(1),
  message: z.string().min(1),
});

export const authVerifyRequestSchema = z.object({
  wallet: base58PubkeySchema,
  signature: z.string().min(1),
  message: z.string().min(1),
});

export const authVerifyResponseSchema = z.object({
  token: z.string().min(1),
  expires: z.number().int().positive(),
});

// ─────────────────────────────────────────────────────────────
// Transaction build/send
// ─────────────────────────────────────────────────────────────

export const txBuildResponseSchema = z.object({
  unsignedTx: z.string().min(1),
});

export const txSendRequestSchema = z.object({
  signedTx: z.string().min(1),
});

export const txSendResponseSchema = z.object({
  signature: z.string().min(1),
});

export const txStatusResponseSchema = z.object({
  signature: z.string().min(1),
  confirmed: z.boolean(),
  slot: z.number().int().nonnegative().optional(),
  err: z.string().nullable().optional(),
});

// ─────────────────────────────────────────────────────────────
// WebSocket protocol
// ─────────────────────────────────────────────────────────────

const wsChannelSchema = z.union([
  z.enum(["projects", "contributions", "votes"]),
  z.string().regex(/^project:.+$/),
]);

export const wsAuthMessageSchema = z.object({
  type: z.literal("auth"),
  token: z.string().min(1),
});

export const wsAuthOkMessageSchema = z.object({
  type: z.literal("auth_ok"),
  agent: base58PubkeySchema,
});

export const wsSubscribeMessageSchema = z.object({
  type: z.literal("subscribe"),
  channels: z.array(wsChannelSchema).min(1),
});

export const wsUnsubscribeMessageSchema = z.object({
  type: z.literal("unsubscribe"),
  channels: z.array(wsChannelSchema).min(1),
});

export const wsProjectCreatedEventSchema = z.object({
  type: z.literal("project.created"),
  data: z.object({
    id: base58PubkeySchema,
    creator: base58PubkeySchema,
    goal: z.number().int().positive(),
    title: z.string().min(1),
    tokenMint: base58PubkeySchema,
    deadline: z.number().int().positive(),
  }),
});

export const wsContributionMadeEventSchema = z.object({
  type: z.literal("contribution.made"),
  data: z.object({
    project: base58PubkeySchema,
    contributor: base58PubkeySchema,
    amount: z.number().int().positive(),
    sig: z.string().min(1),
  }),
});

export const wsMilestoneReleasedEventSchema = z.object({
  type: z.literal("milestone.released"),
  data: z.object({
    project: base58PubkeySchema,
    milestone: z.number().int().min(0).max(255),
    sig: z.string().min(1),
  }),
});

export const wsVoteCastEventSchema = z.object({
  type: z.literal("vote.cast"),
  data: z.object({
    project: base58PubkeySchema,
    voter: base58PubkeySchema,
    support: z.boolean(),
    sig: z.string().min(1),
  }),
});

export const wsGoalReachedEventSchema = z.object({
  type: z.literal("goal.reached"),
  data: z.object({
    project: base58PubkeySchema,
    totalRaised: z.number().int().nonnegative(),
  }),
});

export const wsServerEventSchema = z.discriminatedUnion("type", [
  wsAuthOkMessageSchema,
  wsProjectCreatedEventSchema,
  wsContributionMadeEventSchema,
  wsMilestoneReleasedEventSchema,
  wsVoteCastEventSchema,
  wsGoalReachedEventSchema,
]);

export const wsRpcMethodSchema = z.enum([
  "projects.list",
  "projects.create",
  "tx.build",
]);

export const wsRpcRequestSchema = z.object({
  id: z.string().min(1),
  type: z.literal("rpc"),
  method: wsRpcMethodSchema,
  params: z.record(z.string(), z.unknown()),
});

export const wsRpcResultSchema = z.object({
  id: z.string().min(1),
  type: z.literal("rpc_result"),
  result: z.unknown(),
});

export const wsRpcErrorSchema = z.object({
  id: z.string().min(1),
  type: z.literal("rpc_error"),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
});

export const wsClientMessageSchema = z.discriminatedUnion("type", [
  wsAuthMessageSchema,
  wsSubscribeMessageSchema,
  wsUnsubscribeMessageSchema,
  wsRpcRequestSchema,
]);

// ─────────────────────────────────────────────────────────────
// Platform discovery / stats
// ─────────────────────────────────────────────────────────────

export const platformStatsSchema = z.object({
  totalRaised: z.number().int().nonnegative(),
  activeProjects: z.number().int().nonnegative(),
  agentCount: z.number().int().nonnegative(),
  txCount: z.number().int().nonnegative(),
});

export const agentFundManifestSchema = z.object({
  platform: z.string().min(1),
  version: z.string().min(1),
  tagline: z.string().min(1),
  chain: z.literal("solana"),
  network: z.enum(["devnet", "mainnet-beta"]),
  token: z.array(supportedTokenSchema),
  endpoints: z.object({
    api: z.string().url(),
    openapi: z.string().url(),
    graphql: z.string().url(),
    websocket: z.string(),
    mcp: z.string().url(),
    acp: z.string().url(),
    sse: z.string().url(),
  }),
  auth: z.literal("solana-keypair-jwt"),
  capabilities: z.array(z.string()),
  agent_protocols: z.array(z.string()),
  programs: z.object({
    registry: z.string(),
    escrow: z.string(),
    reputation: z.string(),
  }),
});
