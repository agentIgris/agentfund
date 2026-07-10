/**
 * runs/executor.ts — starts a run for a given AgentDefinition and wires
 * its RunContext to the run store. Called once from POST /runs; the
 * sync/async branching mirrors the spec: "sync agents respond inline,
 * async agents return run_id".
 */
import { runStore } from "./run-store.js";
import type { AgentDefinition, RunContext, RunRecord } from "../types.js";

/**
 * Starts executing `def` for `run`.
 *
 * - If `def.manifest.async` is false, this *awaits* the agent and only
 *   returns once the run has reached a terminal state — the caller
 *   (POST /runs) can then respond with the completed run inline.
 * - If `def.manifest.async` is true, this kicks off execution but does
 *   not await it — the caller responds immediately with the still-
 *   "running" run, and progress/completion arrives via the run's SSE
 *   stream (GET /runs/:id/events) and/or polling GET /runs/:id.
 */
export async function startRun(def: AgentDefinition, run: RunRecord, input: unknown): Promise<void> {
  const signal = runStore.getSignal(run.run_id);
  if (!signal) throw new Error(`startRun: unknown run_id ${run.run_id}`);

  const ctx: RunContext = {
    run_id: run.run_id,
    emit: (event) => runStore.emitEvent(run.run_id, event),
    signal,
    isCancelled: () => signal.aborted,
  };

  const runAgent = async (): Promise<void> => {
    try {
      const output = await def.execute(input, ctx);
      // MonitorAgent resolves after being cancelled (client disconnected) — don't
      // clobber the "cancelled" terminal state with a spurious "complete".
      if (runStore.get(run.run_id)?.status !== "cancelled") {
        runStore.emitEvent(run.run_id, { status: "complete", output });
      }
    } catch (err) {
      runStore.emitEvent(run.run_id, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  if (def.manifest.async) {
    runStore.emitEvent(run.run_id, { status: "running" });
    void runAgent();
    return;
  }

  await runAgent();
}
