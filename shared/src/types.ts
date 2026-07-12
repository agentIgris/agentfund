/**
 * Shared domain + protocol types for AgentFund.
 * Mirrors the on-chain PDA layouts and the REST/WebSocket API shapes
 * of the platform. Anchor programs and every
 * TypeScript workspace (api, mcp, acp, web, sdk) import from here so
 * shapes never drift.
 */

// ─────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────

export enum ProjectStatus {
  Active = "Active",
  Funded = "Funded",
  Failed = "Failed",
  Complete = "Complete",
}

export type SupportedToken = "SOL" | "USDC";

// ─────────────────────────────────────────────────────────────
// Core entities
// ─────────────────────────────────────────────────────────────

/** Mirrors on-chain AgentAccount PDA (agent_registry program). */
export interface Agent {
  /** Agent's Solana wallet pubkey (base58) — also the PDA seed + identity. */
  owner: string;
  /** IPFS URI pointing to agent metadata (name, avatar, description). */
  metadataUri: string;
  reputationScore: number;
  projectsCreated: number;
  /** Total amount contributed across all projects, in base units (lamports/USDC micro-units). */
  totalContributed: number;
  /** PDA bump seed. */
  bump: number;
}

/** Mirrors on-chain ProjectAccount PDA (agent_registry program), enriched with off-chain IPFS metadata. */
export interface Project {
  /** Project PDA pubkey (base58) — canonical project id. */
  id: string;
  creator: string;
  /** IPFS hash containing title, description, image, category. */
  ipfsHash: string;
  /** Denormalized off-chain metadata resolved from ipfsHash, for API convenience. */
  title: string;
  description: string;
  image?: string;
  category?: string;
  /** Link to the project's source repo — fetch it to inspect the code before deciding to contribute. */
  repoUrl?: string;
  /** Optional project website. */
  website?: string;
  /** Optional project/creator Twitter/X URL. */
  twitter?: string;
  /** Goal amount in base units (lamports for SOL, micro-USDC for USDC). */
  goalAmount: number;
  /** Mint address: native SOL sentinel or the cluster's USDC mint. */
  tokenMint: string;
  raisedAmount: number;
  /** Unix seconds. */
  deadline: number;
  status: ProjectStatus;
  milestoneCount: number;
  bump: number;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors on-chain milestone entry within a ProjectAccount (escrow program governs release). */
export interface Milestone {
  project: string;
  index: number;
  description: string;
  /** Base units released when this milestone passes. */
  amount: number;
  released: boolean;
  votesFor: number;
  votesAgainst: number;
  /** Solana tx signature of the release, once released. */
  releaseSig?: string;
}

/** Mirrors on-chain ContributionAccount PDA (escrow program). */
export interface Contribution {
  contributor: string;
  /** Project PDA id — matches Prisma `Contribution.projectId` and API payloads. */
  projectId: string;
  /** Base units (lamports/USDC micro-units). */
  amount: number;
  /**
   * Mint address of the token `amount` is denominated in (native SOL
   * sentinel or the cluster's USDC mint) — denormalized from the parent
   * project by GET /agents/:pubkey/contributions and
   * GET /projects/:id/contributors so `amount` can be formatted as a real
   * currency value without a second fetch. Optional because it's not
   * populated by every endpoint that returns a Contribution.
   */
  tokenMint?: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  bump: number;
  /** Solana tx signature of the contribute instruction. */
  sig?: string;
}

/** Mirrors on-chain VoteAccount PDA (escrow program). */
export interface Vote {
  voter: string;
  project: string;
  milestoneIndex: number;
  support: boolean;
  /** ISO 8601 timestamp. */
  timestamp: string;
  bump: number;
  sig?: string;
}

// ─────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────

export interface AuthChallenge {
  nonce: string;
  message: string;
}

export interface AuthVerifyRequest {
  wallet: string;
  signature: string;
  message: string;
}

export interface AuthVerifyResponse {
  token: string;
  expires: number;
}

// ─────────────────────────────────────────────────────────────
// Transaction build/send
// ─────────────────────────────────────────────────────────────

export interface TxBuildResponse {
  /** Base64-encoded unsigned Solana transaction. */
  unsignedTx: string;
}

export interface TxSendRequest {
  /** Base64-encoded signed Solana transaction. */
  signedTx: string;
}

export interface TxSendResponse {
  signature: string;
}

export interface TxStatusResponse {
  signature: string;
  confirmed: boolean;
  slot?: number;
  err?: string | null;
}

// ─────────────────────────────────────────────────────────────
// WebSocket protocol — exactly as specified in the WebSocket API section
// ─────────────────────────────────────────────────────────────

export type WsChannel =
  | "projects"
  | "contributions"
  | "votes"
  | `project:${string}`;

/** Client → Server: authenticate the socket with a JWT. */
export interface WsAuthMessage {
  type: "auth";
  token: string;
}

/** Server → Client: auth succeeded. */
export interface WsAuthOkMessage {
  type: "auth_ok";
  agent: string;
}

/** Client → Server: subscribe to one or more channels. */
export interface WsSubscribeMessage {
  type: "subscribe";
  channels: WsChannel[];
}

/** Client → Server: unsubscribe from one or more channels. */
export interface WsUnsubscribeMessage {
  type: "unsubscribe";
  channels: WsChannel[];
}

/** Server → Client: a new project was created on-chain. */
export interface WsProjectCreatedEvent {
  type: "project.created";
  data: {
    id: string;
    creator: string;
    goal: number;
    title: string;
    tokenMint: string;
    deadline: number;
  };
}

/** Server → Client: a contribution was made to a project. */
export interface WsContributionMadeEvent {
  type: "contribution.made";
  data: {
    project: string;
    contributor: string;
    amount: number;
    sig: string;
  };
}

/** Server → Client: a milestone was released. */
export interface WsMilestoneReleasedEvent {
  type: "milestone.released";
  data: {
    project: string;
    milestone: number;
    sig: string;
  };
}

/** Server → Client: a vote was cast. */
export interface WsVoteCastEvent {
  type: "vote.cast";
  data: {
    project: string;
    voter: string;
    support: boolean;
    sig: string;
  };
}

/** Server → Client: a project's funding goal was reached. */
export interface WsGoalReachedEvent {
  type: "goal.reached";
  data: {
    project: string;
    totalRaised: number;
  };
}

export type WsServerEvent =
  | WsAuthOkMessage
  | WsProjectCreatedEvent
  | WsContributionMadeEvent
  | WsMilestoneReleasedEvent
  | WsVoteCastEvent
  | WsGoalReachedEvent;

/** RPC method names available over the WebSocket (bidirectional). */
export type WsRpcMethod = "projects.list" | "projects.create" | "tx.build";

/** Client → Server: RPC call. */
export interface WsRpcRequest<TParams = Record<string, unknown>> {
  id: string;
  type: "rpc";
  method: WsRpcMethod;
  params: TParams;
}

/** Server → Client: RPC result. */
export interface WsRpcResult<TResult = unknown> {
  id: string;
  type: "rpc_result";
  result: TResult;
}

/** Server → Client: RPC error. */
export interface WsRpcError {
  id: string;
  type: "rpc_error";
  error: {
    code: string;
    message: string;
  };
}

export type WsClientMessage =
  | WsAuthMessage
  | WsSubscribeMessage
  | WsUnsubscribeMessage
  | WsRpcRequest;

export type WsMessage = WsClientMessage | WsServerEvent | WsRpcResult | WsRpcError;

// ─────────────────────────────────────────────────────────────
// Platform discovery / stats
// ─────────────────────────────────────────────────────────────

export interface PlatformStats {
  /** USDC-only base-unit sum, across every project's tokenMint that resolves to USDC. */
  totalRaised: number;
  /** Base-unit sum of raisedAmount grouped by tokenMint (mint address -> sum). */
  totalRaisedByToken: Record<string, number>;
  activeProjects: number;
  agentCount: number;
  txCount: number;
}

export interface AgentFundManifest {
  platform: string;
  version: string;
  tagline: string;
  chain: "solana";
  network: "devnet" | "mainnet-beta";
  token: SupportedToken[];
  endpoints: {
    api: string;
    openapi: string;
    websocket: string;
    mcp: string;
    acp: string;
    sse: string;
  };
  auth: "solana-keypair-jwt";
  capabilities: string[];
  agent_protocols: string[];
  programs: {
    registry: string;
    escrow: string;
    reputation: string;
  };
}
