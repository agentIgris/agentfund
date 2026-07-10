/**
 * services/helius.ts — Helius webhook receiver + Anchor event parsing.
 * Registers `POST /indexer/helius-webhook` (path configurable via
 * HELIUS_WEBHOOK_PATH), verifies the shared-secret header Helius is
 * configured to send, then decodes each of the three programs'
 * `#[event]` emissions out of the transactions' `logMessages` (Anchor's
 * `emit!` macro logs `Program data: <base64 sighash+borsh>` via
 * `sol_log_data`, wrapped between that program's `invoke`/`success` log
 * lines — we track an invoke stack to attribute each event to the
 * program that emitted it).
 */
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { anchorEventDiscriminator, BorshReader } from "./anchorEncoding.js";
import { indexEvent, type ProgramName, type RawProgramEvent } from "./indexer.js";

// ─────────────────────────────────────────────────────────────
// Event decoders — field order mirrors the #[event] structs in
// programs/*/src/lib.rs exactly.
// ─────────────────────────────────────────────────────────────

type EventDecoder = (r: BorshReader) => Record<string, unknown>;

const REGISTRY_EVENT_DECODERS: Record<string, EventDecoder> = {
  AgentRegistered: (r) => ({
    owner: r.readPubkey(),
    metadataUri: r.readString(),
    timestamp: Number(r.readI64()),
  }),
  ProjectCreated: (r) => ({
    project: r.readPubkey(),
    creator: r.readPubkey(),
    projectIndex: r.readU32(),
    ipfsHash: r.readString(),
    goalAmount: r.readU64().toString(),
    tokenMint: r.readPubkey(),
    deadline: Number(r.readI64()),
    milestoneCount: r.readU8(),
    timestamp: Number(r.readI64()),
  }),
  ProjectStatusChanged: (r) => ({
    project: r.readPubkey(),
    oldStatus: PROJECT_STATUS_VARIANTS[r.readU8()],
    newStatus: PROJECT_STATUS_VARIANTS[r.readU8()],
    changedBy: r.readPubkey(),
    timestamp: Number(r.readI64()),
  }),
};

const ESCROW_EVENT_DECODERS: Record<string, EventDecoder> = {
  ContributionMade: (r) => ({
    project: r.readPubkey(),
    contributor: r.readPubkey(),
    amount: r.readU64().toString(),
    totalDeposited: r.readU64().toString(),
    timestamp: Number(r.readI64()),
  }),
  VoteCast: (r) => ({
    project: r.readPubkey(),
    voter: r.readPubkey(),
    milestoneIndex: r.readU8(),
    support: r.readBool(),
    weight: r.readU64().toString(),
    timestamp: Number(r.readI64()),
  }),
  MilestoneReleased: (r) => ({
    project: r.readPubkey(),
    milestoneIndex: r.readU8(),
    amount: r.readU64().toString(),
    creator: r.readPubkey(),
    totalReleased: r.readU64().toString(),
    timestamp: Number(r.readI64()),
  }),
  Refunded: (r) => ({
    project: r.readPubkey(),
    contributor: r.readPubkey(),
    amount: r.readU64().toString(),
    timestamp: Number(r.readI64()),
  }),
};

const REPUTATION_EVENT_DECODERS: Record<string, EventDecoder> = {
  ReputationInitialized: (r) => ({
    agent: r.readPubkey(),
    score: r.readU64().toString(),
    timestamp: Number(r.readI64()),
  }),
  ReputationUpdated: (r) => ({
    agent: r.readPubkey(),
    oldScore: r.readU64().toString(),
    newScore: r.readU64().toString(),
    delta: Number(r.readI64()),
    reason: r.readU8(),
    eventsCount: r.readU32(),
    timestamp: Number(r.readI64()),
  }),
};

const PROJECT_STATUS_VARIANTS = ["Active", "Funded", "Failed", "Complete"] as const;

const PROGRAM_DECODERS: Record<ProgramName, Record<string, EventDecoder>> = {
  agent_registry: REGISTRY_EVENT_DECODERS,
  escrow: ESCROW_EVENT_DECODERS,
  reputation: REPUTATION_EVENT_DECODERS,
};

function programNameFor(programId: string): ProgramName | undefined {
  if (programId === config.solana.registryProgramId) return "agent_registry";
  if (programId === config.solana.escrowProgramId) return "escrow";
  if (programId === config.solana.reputationProgramId) return "reputation";
  return undefined;
}

/** Precomputed discriminator → (program, eventName) lookup, scoped per program's known events. */
function buildDiscriminatorIndex(): Map<string, { program: ProgramName; eventName: string }[]> {
  const index = new Map<string, { program: ProgramName; eventName: string }[]>();
  for (const [program, decoders] of Object.entries(PROGRAM_DECODERS) as [ProgramName, Record<string, EventDecoder>][]) {
    for (const eventName of Object.keys(decoders)) {
      const key = anchorEventDiscriminator(eventName).toString("hex");
      const bucket = index.get(key) ?? [];
      bucket.push({ program, eventName });
      index.set(key, bucket);
    }
  }
  return index;
}

const DISCRIMINATOR_INDEX = buildDiscriminatorIndex();

// ─────────────────────────────────────────────────────────────
// Helius payload parsing
// ─────────────────────────────────────────────────────────────

interface HeliusTransactionLike {
  signature?: string;
  slot?: number;
  meta?: { logMessages?: string[] };
  logMessages?: string[];
}

const INVOKE_RE = /^Program (\w+) invoke \[\d+]$/;
const RETURN_RE = /^Program (\w+) (success|failed.*)$/;
const DATA_RE = /^Program data: (.+)$/;

/** Parses every decodable Anchor event out of one transaction's logMessages. */
export function parseTransactionLogs(tx: HeliusTransactionLike): RawProgramEvent[] {
  const logs = tx.meta?.logMessages ?? tx.logMessages ?? [];
  const signature = tx.signature ?? "";
  const slot = tx.slot ?? 0;

  const stack: string[] = [];
  const events: RawProgramEvent[] = [];

  for (const line of logs) {
    const invoke = INVOKE_RE.exec(line);
    if (invoke) {
      stack.push(invoke[1]!);
      continue;
    }
    const ret = RETURN_RE.exec(line);
    if (ret) {
      stack.pop();
      continue;
    }
    const dataMatch = DATA_RE.exec(line);
    if (!dataMatch) continue;

    const currentProgramId = stack[stack.length - 1];
    if (!currentProgramId) continue;
    const program = programNameFor(currentProgramId);
    if (!program) continue;

    let raw: Buffer;
    try {
      raw = Buffer.from(dataMatch[1]!, "base64");
    } catch {
      continue;
    }
    if (raw.length < 8) continue;

    const discriminator = raw.subarray(0, 8).toString("hex");
    const candidates = DISCRIMINATOR_INDEX.get(discriminator);
    const match = candidates?.find((c) => c.program === program);
    if (!match) continue;

    try {
      const reader = new BorshReader(raw.subarray(8));
      const decoded = PROGRAM_DECODERS[program][match.eventName]!(reader);
      events.push({ program, eventName: match.eventName, signature, slot, data: decoded });
    } catch {
      // Malformed/unexpected payload shape — skip rather than crash the webhook.
      continue;
    }
  }

  return events;
}

/** Registers the Helius webhook receiver route on the given Fastify instance. */
export function registerHeliusWebhook(app: FastifyInstance): void {
  app.post(config.helius.webhookPath, async (request, reply) => {
    if (config.helius.webhookSecret) {
      const provided = request.headers["authorization"] ?? request.headers["helius-webhook-secret"];
      if (provided !== config.helius.webhookSecret) {
        return reply.code(401).send({ error: "invalid webhook secret" });
      }
    }

    const body = request.body;
    const transactions: HeliusTransactionLike[] = Array.isArray(body) ? body : [body as HeliusTransactionLike];

    let indexed = 0;
    for (const tx of transactions) {
      const events = parseTransactionLogs(tx);
      for (const event of events) {
        await indexEvent(event, request.log);
        indexed += 1;
      }
    }

    return reply.code(200).send({ ok: true, indexed });
  });
}
