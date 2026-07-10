/**
 * Core ACP types — the run lifecycle and agent-manifest shapes shared
 * across src/runs, src/routes, and src/agents. Follows the IBM ACP open
 * REST pattern (spec: "ACP Server" / "ACP Message Flow"):
 *
 *   External Agent  ->  POST /runs { agent_id, input }
 *                          v
 *                AgentFund executes on Solana
 *                          v
 *                  <- SSE stream of RunEvents <-
 *                     { status: "running", output_chunk: ... }
 *                     { status: "complete", output: { ... } }
 */
import type { z, ZodTypeAny } from "zod";

export type RunStatus = "pending" | "running" | "complete" | "failed" | "cancelled";

/** A single event on a run's SSE stream (GET /runs/:id/events). */
export type RunEvent =
  | { status: "running"; output_chunk?: unknown }
  | { status: "complete"; output: unknown }
  | { status: "failed"; error: string }
  | { status: "cancelled" };

/** Persisted state of one run (also what GET /runs/:id returns). */
export interface RunRecord {
  run_id: string;
  agent_id: string;
  status: RunStatus;
  input: unknown;
  output?: unknown;
  error?: string;
  created_at: string;
  updated_at: string;
}

/** GET /agents manifest entry for one delegate-able agent. */
export interface AgentManifest {
  agent_id: string;
  description: string;
  /** Hand-authored JSON-schema mirror of the agent's zod input schema (src/schemas.ts) — kept in lockstep by convention, same as shared/src/schemas.ts vs types.ts. */
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  async: boolean;
}

/** Context handed to every agent's `execute` — how it reports progress/completion for a specific run. */
export interface RunContext {
  run_id: string;
  /** Push an intermediate event (used by async agents, esp. MonitorAgent's output_chunk stream). */
  emit: (event: RunEvent) => void;
  /**
   * Aborted once the run's SSE stream has no attached listeners left
   * (client disconnected) — long-lived agents (MonitorAgent) should
   * listen for `"abort"` on this to tear down external resources (its
   * WebSocket subscription to the API) and resolve. Agents that don't
   * need cancellation (ProjectEvaluatorAgent, DonationAgent — both
   * resolve promptly on their own) can ignore it.
   */
  signal: AbortSignal;
  /** Convenience: `signal.aborted`. */
  isCancelled: () => boolean;
}

/** One entry in the agent registry (src/agents/index.ts). */
export interface AgentDefinition<TInput extends ZodTypeAny = ZodTypeAny> {
  manifest: AgentManifest;
  inputSchema: TInput;
  /**
   * Executes the agent for one run.
   *  - Sync agents (`manifest.async === false`) resolve with the final output; the run store wraps it in a "complete" event.
   *  - Async agents (`manifest.async === true`) may run indefinitely, calling `ctx.emit` themselves and resolving only when finished (or never, for MonitorAgent — it resolves when cancelled).
   */
  execute: (input: z.infer<TInput>, ctx: RunContext) => Promise<unknown>;
}
