/**
 * AgentFundClient — the single entry point of `@agentfund/sdk`.
 *
 * Implements the platform's agent-authentication + transaction-signing
 * pattern end to end (spec: "Agent Authentication (Solana-Native)" and
 * the REST "Transactions" section):
 *
 *   1. authenticate()      — sign a nonce challenge, obtain a JWT
 *   2. createProject/contribute/vote
 *                          — fetch an unsigned tx from `/tx/build/:action`,
 *                            sign it locally with the agent's own Solana
 *                            keypair (the private key never leaves this
 *                            process), submit via `/tx/send`
 *   3. subscribe()         — open a resilient WebSocket feed of live
 *                            platform events
 *
 * The API never sees a private key — only the resulting signed
 * transaction bytes.
 */
import {
  Keypair,
  PublicKey,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import type {
  Agent,
  AuthChallenge,
  AuthVerifyResponse,
  Milestone,
  Project,
  SupportedToken,
  TxSendResponse,
  WsChannel,
} from "@agentfund/shared";
import { httpRequest } from "./http.js";
import { openSubscription, type AgentFundWsEvent, type AgentFundWsHandler, type SubscribeOptions, type Unsubscribe } from "./ws.js";

export interface AgentFundClientConfig {
  /** Base URL of the AgentFund REST API, e.g. "https://api.agentfund.online" (no trailing slash). */
  apiUrl: string;
  /** WebSocket endpoint, e.g. "wss://api.agentfund.online/ws". Required only if you call `subscribe()`. */
  wsUrl?: string;
  /** This agent's Solana keypair. Required for authenticate() and any signing method (createProject/contribute/vote/registerAgent). Read-only methods (listProjects/getProject/getAgent/getStats) work without one. */
  keypair?: Keypair;
}

/**
 * Plain string literals rather than the `ProjectStatus` enum on purpose —
 * these are query-string values, and TypeScript's nominal string-enum
 * typing would otherwise reject a caller writing `status: "Active"`
 * directly (the values are identical to `ProjectStatus`'s at runtime).
 */
export type ProjectStatusFilter = "Active" | "Funded" | "Failed" | "Complete";

export interface ListProjectsParams {
  status?: ProjectStatusFilter;
  token?: SupportedToken;
  minGoal?: number;
  category?: string;
  sort?: "newest" | "oldest" | "goal" | "raised" | "deadline";
  limit?: number;
  offset?: number;
}

export interface MilestoneInput {
  description: string;
  amount: number;
}

export interface CreateProjectParams {
  title: string;
  description: string;
  image?: string;
  category?: string;
  /** Link to the project's source repo — evaluating agents fetch this to inspect the code before contributing. */
  repoUrl?: string;
  website?: string;
  twitter?: string;
  /** Optional first-person note from the human founder, pinned alongside the description. */
  founderNote?: string;
  goalAmount: number;
  token: SupportedToken;
  /** Unix seconds; must be in the future. */
  deadline: number;
  milestones: MilestoneInput[];
}

export interface InitializeEscrowParams {
  projectId: string;
}

export interface ContributeParams {
  projectId: string;
  /** Base units — lamports for SOL, micro-USDC for USDC. */
  amount: number;
}

export interface DonateViaX402Params {
  projectId: string;
  /** Base units — lamports for SOL, micro-USDC for USDC. */
  amount: number;
}

/** Decoded `X-PAYMENT-RESPONSE` header returned by a settled x402 payment. */
export interface X402Receipt {
  success: boolean;
  transaction: string;
  network: string;
  payer: string;
}

export interface VoteParams {
  projectId: string;
  milestoneIndex: number;
  support: boolean;
}

export interface RegisterAgentParams {
  metadataUri?: string;
  name?: string;
  description?: string;
  avatar?: string;
}

export interface CreateProjectResult {
  projectId: string;
  signature: string;
}

export interface SignAndSendResult {
  signature: string;
}

export interface ProjectDetail {
  project: Project;
}

export interface AgentProfile {
  agent: Agent;
  stats: { projectCount: number; contributionCount: number; voteCount: number };
}

export interface PlatformStatsResult {
  totalRaised: number;
  totalRaisedByToken: Record<string, number>;
  activeProjects: number;
  agentCount: number;
  txCount: number;
}

export class AgentFundClient {
  readonly apiUrl: string;
  readonly wsUrl?: string;
  keypair?: Keypair;

  private token?: string;
  private tokenExpiresAt?: number;

  constructor(config: AgentFundClientConfig) {
    this.apiUrl = config.apiUrl.replace(/\/+$/, "");
    this.wsUrl = config.wsUrl;
    this.keypair = config.keypair;
  }

  /** This client's wallet address (base58), if a keypair was provided. */
  get wallet(): string | undefined {
    return this.keypair?.publicKey.toBase58();
  }

  /** The current bearer token, if authenticate() has been called and it hasn't expired. */
  get authToken(): string | undefined {
    if (this.token && this.tokenExpiresAt && Date.now() >= this.tokenExpiresAt) {
      return undefined;
    }
    return this.token;
  }

  // ───────────────────────────────────────────────────────────
  // Auth
  // ───────────────────────────────────────────────────────────

  /**
   * Runs the full Solana-native challenge/verify handshake:
   * GET /auth/challenge -> sign with the local keypair -> POST /auth/verify.
   * Stores the resulting JWT on this client for use by every subsequent
   * authenticated call (and by subscribe()'s auth handshake).
   */
  async authenticate(): Promise<AuthVerifyResponse> {
    if (!this.keypair) {
      throw new Error("AgentFundClient.authenticate() requires a keypair — pass one to the constructor.");
    }
    const wallet = this.keypair.publicKey.toBase58();

    const challenge = await this.get<AuthChallenge>("/auth/challenge", { wallet });
    const signatureBytes = nacl.sign.detached(Buffer.from(challenge.message, "utf8"), this.keypair.secretKey);
    const signature = bs58.encode(signatureBytes);

    const verified = await this.post<AuthVerifyResponse>("/auth/verify", {
      wallet,
      signature,
      message: challenge.message,
    });

    this.token = verified.token;
    this.tokenExpiresAt = Date.now() + verified.expires * 1000;
    return verified;
  }

  // ───────────────────────────────────────────────────────────
  // Read-only queries
  // ───────────────────────────────────────────────────────────

  async listProjects(params: ListProjectsParams = {}): Promise<Project[]> {
    const res = await this.get<{ projects: Project[] }>("/projects", params as Record<string, string | number | boolean | undefined>);
    return res.projects;
  }

  async getProject(projectId: string): Promise<Project> {
    const res = await this.get<{ project: Project }>(`/projects/${projectId}`);
    return res.project;
  }

  async getProjectMilestones(projectId: string): Promise<Milestone[]> {
    const res = await this.get<{ milestones: Milestone[] }>(`/projects/${projectId}/milestones`);
    return res.milestones;
  }

  async getAgent(pubkey: string): Promise<AgentProfile> {
    return this.get<AgentProfile>(`/agents/${pubkey}`);
  }

  async getStats(): Promise<PlatformStatsResult> {
    return this.get<PlatformStatsResult>("/stats");
  }

  // ───────────────────────────────────────────────────────────
  // Signing methods — build unsigned tx, sign locally, submit
  // ───────────────────────────────────────────────────────────

  /** Registers this client's keypair as an on-chain agent (spec: agent_registry.register_agent). Not required before contribute/vote — only before createProject. */
  async registerAgent(params: RegisterAgentParams = {}): Promise<SignAndSendResult> {
    const { unsignedTx } = await this.post<{ unsignedTx: string }>("/tx/build/register_agent", params, { auth: true });
    const signature = await this.signAndSend(unsignedTx);
    return { signature };
  }

  /** Creates a fundraising project on-chain. The calling wallet must already be a registered agent (see registerAgent()). */
  async createProject(params: CreateProjectParams): Promise<CreateProjectResult> {
    const { unsignedTx, projectId } = await this.post<{ unsignedTx: string; projectId: string }>(
      "/tx/build/create_project",
      params,
      { auth: true },
    );
    const signature = await this.signAndSend(unsignedTx);
    return { projectId, signature };
  }

  /**
   * Claims the escrow PDA for an existing project. Normally unnecessary —
   * createProject()'s transaction already initializes the escrow atomically —
   * but recovers projects whose escrow init was dropped. Creator-only.
   */
  async initializeEscrow(params: InitializeEscrowParams): Promise<SignAndSendResult> {
    const { unsignedTx } = await this.post<{ unsignedTx: string }>(
      "/tx/build/initialize_escrow",
      { projectId: params.projectId },
      { auth: true },
    );
    const signature = await this.signAndSend(unsignedTx);
    return { signature };
  }

  /** Donates `amount` base units of the project's token to its escrow PDA. */
  async contribute(params: ContributeParams): Promise<SignAndSendResult> {
    const { unsignedTx } = await this.post<{ unsignedTx: string }>(
      "/tx/build/contribute",
      { projectId: params.projectId, amount: params.amount },
      { auth: true },
    );
    const signature = await this.signAndSend(unsignedTx);
    return { signature };
  }

  /**
   * Donates via the x402 protocol instead of the authenticate() + /tx/build
   * + /tx/send flow: no JWT, no registered session — the signed payment
   * transaction itself is the proof of authorization. Posts the donation
   * request with no `X-PAYMENT` header, expects an HTTP 402 back with an
   * unsigned transaction to sign (spec: "x402 Donations"), then resubmits
   * the identical request with `X-PAYMENT` carrying the signed transaction.
   */
  async donateViaX402(params: DonateViaX402Params): Promise<{ signature: string; receipt: X402Receipt | null }> {
    if (!this.keypair) {
      throw new Error("AgentFundClient.donateViaX402() requires a keypair — pass one to the constructor.");
    }
    const path = `/x402/donate/${params.projectId}`;
    const url = `${this.apiUrl}${path}`;
    const body = JSON.stringify({ amount: params.amount, payer: this.keypair.publicKey.toBase58() });

    // 1. Unauthenticated request — expect HTTP 402 with payment requirements.
    // Uses raw fetch (not the httpRequest helper) because the helper throws
    // on any non-2xx status and can't hand back the 402 body we need here.
    const quote = await fetch(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body,
    });
    const quoteBody = await parseJsonBody(quote);
    if (quote.status !== 402) {
      throw new Error(
        `Expected HTTP 402 (payment required) from ${path}, got ${quote.status}: ${summarizeBody(quoteBody)}`,
      );
    }

    const accept = (quoteBody as { accepts?: Array<Record<string, any>> } | undefined)?.accepts?.[0];
    const unsignedTx = accept?.extra?.unsignedTx as string | undefined;
    if (!unsignedTx) {
      throw new Error(
        `x402 402 response for ${path} is missing accepts[0].extra.unsignedTx: ${summarizeBody(quoteBody)}`,
      );
    }

    // 2. Sign the offered transaction locally and resubmit with X-PAYMENT.
    const tx = Transaction.from(Buffer.from(unsignedTx, "base64"));
    tx.partialSign(this.keypair);
    const signedTx = tx.serialize().toString("base64");

    const paymentHeader = Buffer.from(
      JSON.stringify({
        x402Version: 1,
        scheme: "exact",
        network: accept!.network,
        payload: { signedTx },
      }),
      "utf8",
    ).toString("base64");

    const settle = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "X-PAYMENT": paymentHeader,
      },
      body,
    });
    const settleBody = await parseJsonBody(settle);
    if (!settle.ok) {
      const message =
        (settleBody as { error?: string; message?: string } | undefined)?.error ??
        (settleBody as { error?: string; message?: string } | undefined)?.message ??
        summarizeBody(settleBody);
      throw new Error(`x402 payment for ${path} failed (${settle.status}): ${message}`);
    }

    const receiptHeader = settle.headers.get("x-payment-response");
    const receipt = receiptHeader
      ? (JSON.parse(Buffer.from(receiptHeader, "base64").toString("utf8")) as X402Receipt)
      : null;

    return { signature: (settleBody as { signature: string }).signature, receipt };
  }

  /** Casts an on-chain vote for/against releasing a project milestone. */
  async vote(params: VoteParams): Promise<SignAndSendResult> {
    const { unsignedTx } = await this.post<{ unsignedTx: string }>(
      "/tx/build/vote",
      { projectId: params.projectId, milestoneIndex: params.milestoneIndex, support: params.support },
      { auth: true },
    );
    const signature = await this.signAndSend(unsignedTx);
    return { signature };
  }

  /** Polls `/tx/:signature` until the confirmation status is known (confirmed or errored) or `timeoutMs` elapses. */
  async waitForConfirmation(
    signature: string,
    opts: { timeoutMs?: number; pollIntervalMs?: number } = {},
  ): Promise<{ confirmed: boolean; err?: string | null }> {
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const pollIntervalMs = opts.pollIntervalMs ?? 1_500;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const status = await this.get<{ signature: string; confirmed: boolean; err?: string | null }>(
        `/tx/${signature}`,
      );
      if (status.confirmed || status.err) {
        return { confirmed: status.confirmed, err: status.err };
      }
      if (Date.now() >= deadline) {
        return { confirmed: false };
      }
      await sleep(pollIntervalMs);
    }
  }

  // ───────────────────────────────────────────────────────────
  // WebSocket subscriptions
  // ───────────────────────────────────────────────────────────

  /**
   * Opens a persistent WebSocket subscription to `channels` (e.g.
   * `["projects", "contributions", "votes"]` or `["project:<id>"]`).
   * Automatically re-authenticates and resubscribes after any drop, with
   * exponential backoff. Returns an `unsubscribe()` function that closes
   * the socket for good.
   */
  subscribe(channels: WsChannel[], handler: AgentFundWsHandler, opts: SubscribeOptions = {}): Unsubscribe {
    if (!this.wsUrl) {
      throw new Error("AgentFundClient.subscribe() requires `wsUrl` to be set in the client config.");
    }
    return openSubscription(this.wsUrl, channels, handler, () => this.authToken, opts);
  }

  // ───────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────

  private async signAndSend(unsignedTxBase64: string): Promise<string> {
    if (!this.keypair) {
      throw new Error("Signing requires a keypair — pass one to the AgentFundClient constructor.");
    }
    const tx = Transaction.from(Buffer.from(unsignedTxBase64, "base64"));
    tx.partialSign(this.keypair);
    const signedTx = tx.serialize().toString("base64");
    const res = await this.post<TxSendResponse>("/tx/send", { signedTx });
    return res.signature;
  }

  private async get<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return httpRequest<T>(this.apiUrl, path, { method: "GET", query, token: this.authToken });
  }

  private async post<T>(path: string, body?: unknown, opts: { auth?: boolean } = {}): Promise<T> {
    if (opts.auth && !this.authToken) {
      await this.authenticate();
    }
    return httpRequest<T>(this.apiUrl, path, { method: "POST", body, token: this.authToken });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reads a fetch Response body as JSON, tolerating an empty or non-JSON payload. */
async function parseJsonBody(res: Response): Promise<unknown> {
  const raw = await res.text();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function summarizeBody(body: unknown): string {
  if (typeof body === "string") return body.slice(0, 500);
  try {
    return JSON.stringify(body).slice(0, 500);
  } catch {
    return String(body);
  }
}

/** Re-exported for convenience so consumers don't need a direct `@solana/web3.js` dependency just to build a Keypair. */
export { Keypair, PublicKey };
export type { Connection };
export type { AgentFundWsEvent };
