/**
 * Zod input schemas for the 4 delegate-able ACP agents — spec's "ACP
 * Server" YAML block, § "4 Delegate-able ACP Agents". These are the
 * runtime source of truth; src/manifests/agents.ts hand-mirrors them as
 * JSON Schema for GET /agents (kept in lockstep by convention, same as
 * shared/src/schemas.ts documents for types.ts).
 *
 * Every field the spec's YAML names literally (title, goal_usdc,
 * milestones[], category, deadline_days, project_id, amount, token,
 * events[]) is present. Fields the YAML left generic (e.g. what shape
 * each milestone entry has) are filled in following the same
 * `{ description, amount }` shape POST /tx/build/create_project already
 * expects (api/src/schema/tx.ts) — documented inline below.
 */
import { z } from "zod";
import { supportedTokenSchema } from "@agentfund/shared";

/** Loose base58 pubkey check — mirrors @agentfund/shared's schemas.ts (not itself exported there); same local-mirror pattern as api/src/schema/common.ts. */
const base58PubkeySchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid base58 pubkey");

// ─────────────────────────────────────────────────────────────
// FundRaisingAgent
// ─────────────────────────────────────────────────────────────

export const fundRaisingMilestoneSchema = z.object({
  description: z.string().min(1).max(500),
  /** USDC, human units (e.g. 1500.50), converted to micro-USDC (x1e6) before hitting the REST API. */
  amount_usdc: z.number().positive(),
});

export const fundRaisingAgentInputSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  /** Human-readable USDC (e.g. 25000), not micro-units — this agent creates USDC-denominated campaigns. */
  goal_usdc: z.number().positive(),
  milestones: z.array(fundRaisingMilestoneSchema).min(1).max(10),
  category: z.string().min(1).max(100).optional(),
  deadline_days: z.number().int().positive().max(3650),
});
export type FundRaisingAgentInput = z.infer<typeof fundRaisingAgentInputSchema>;

export const fundRaisingAgentOutputSchema = z.object({
  project_id: z.string().min(1),
  project_url: z.string().url(),
  unsigned_tx: z.string().min(1),
  solscan_url: z.string().url(),
});
export type FundRaisingAgentOutput = z.infer<typeof fundRaisingAgentOutputSchema>;

// ─────────────────────────────────────────────────────────────
// ProjectEvaluatorAgent
// ─────────────────────────────────────────────────────────────

export const projectEvaluatorAgentInputSchema = z.object({
  project_id: base58PubkeySchema,
});
export type ProjectEvaluatorAgentInput = z.infer<typeof projectEvaluatorAgentInputSchema>;

export const evaluationRecommendationSchema = z.enum(["strong_fund", "fund", "caution", "avoid"]);

export const projectEvaluatorAgentOutputSchema = z.object({
  score: z.number().int().min(0).max(100),
  recommendation: evaluationRecommendationSchema,
  risk_flags: z.array(z.string()),
  on_chain_verified: z.boolean(),
});
export type ProjectEvaluatorAgentOutput = z.infer<typeof projectEvaluatorAgentOutputSchema>;

// ─────────────────────────────────────────────────────────────
// DonationAgent
// ─────────────────────────────────────────────────────────────

export const donationAgentInputSchema = z.object({
  project_id: base58PubkeySchema,
  /** Human units — SOL or USDC depending on `token`, not lamports/micro-units. */
  amount: z.number().positive(),
  token: supportedTokenSchema,
});
export type DonationAgentInput = z.infer<typeof donationAgentInputSchema>;

export const donationAgentOutputSchema = z.object({
  unsigned_tx: z.string().min(1),
  /**
   * Solana transaction signatures are the ed25519 signature over the
   * message, so they cannot be known before the caller signs the
   * transaction with their own keypair — `null` here always. Kept in
   * the output shape because the spec names it; see README for the
   * sign-then-confirm flow.
   */
  expected_sig: z.string().nullable(),
  confirmation_url: z.string().min(1),
});
export type DonationAgentOutput = z.infer<typeof donationAgentOutputSchema>;

// ─────────────────────────────────────────────────────────────
// MonitorAgent
// ─────────────────────────────────────────────────────────────

export const monitorEventFilterSchema = z.enum(["milestone", "goal_reached", "vote", "refund"]);

export const monitorAgentInputSchema = z.object({
  project_id: base58PubkeySchema,
  events: z.array(monitorEventFilterSchema).min(1),
});
export type MonitorAgentInput = z.infer<typeof monitorAgentInputSchema>;

/** One pushed AgentEvent — the run's output_chunk payload; there is no single final "output" (this agent streams). */
export const agentEventSchema = z.object({
  type: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});
export type AgentEvent = z.infer<typeof agentEventSchema>;

// ─────────────────────────────────────────────────────────────
// POST /runs request envelope (IBM ACP open REST pattern) — the
// per-agent input shapes above are validated against `input` once
// `agent_id` is resolved to an AgentDefinition (src/agents/index.ts).
// ─────────────────────────────────────────────────────────────

export const createRunRequestSchema = z.object({
  agent_id: z.string().min(1),
  input: z.unknown(),
});
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;

export const runIdParamSchema = z.object({
  id: z.string().min(1),
});
