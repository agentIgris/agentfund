/**
 * runs/run-store.ts — in-memory run store + pub/sub for the ACP run
 * lifecycle (spec: "Run store in memory Map with TTL cleanup").
 *
 * PRODUCTION NOTE — swap for Redis:
 * This implementation is a single-process `Map<string, RunRecord>` plus
 * a per-run Node `EventEmitter` for SSE fan-out and a small bounded
 * event-history buffer (so an SSE client that connects a moment after
 * POST /runs still sees everything emitted so far). It works for
 * exactly one ACP server process. To run this horizontally (multiple
 * ACP instances behind a load balancer, as implied by the api/mcp
 * workspaces' Redis-backed broker — see api/src/services/broker.ts):
 *   1. Replace the `Map` with Redis hashes/JSON (`HSET run:<id> ...`,
 *      or a JSON value per run key) so any instance can read a run's
 *      current state regardless of which instance created it.
 *   2. Replace the per-run `EventEmitter` + history array with a Redis
 *      Stream per run (`XADD agentfund:acp:run:<id> ...`) — gives
 *      durable, replayable history *and* live fan-out (`XREAD BLOCK`)
 *      in one primitive, mirroring the broker pattern api/ already
 *      uses for WS/SSE fan-out.
 *   3. TTL cleanup becomes `EXPIRE run:<id> <ttlSeconds>` at write time
 *      instead of the manual sweep interval below.
 *   4. Cancellation (AbortController) becomes a small "cancelled" flag
 *      in the Redis run record, polled or pushed the same way.
 */
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { config } from "../config.js";
import type { RunEvent, RunRecord, RunStatus } from "../types.js";

/** Cap on buffered events per run, so a long-lived MonitorAgent run can't grow memory unbounded — late subscribers only get the most recent tail. */
const HISTORY_LIMIT = 200;

interface InternalRun {
  record: RunRecord;
  emitter: EventEmitter;
  history: RunEvent[];
  controller: AbortController;
  /** Number of currently-attached SSE listeners; used to detect client disconnect for long-lived agents. */
  listenerCount: number;
}

const TERMINAL: ReadonlySet<RunStatus> = new Set(["complete", "failed", "cancelled"]);

export class RunStore {
  private runs = new Map<string, InternalRun>();
  private sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly ttlMs = config.runs.ttlMs,
    sweepIntervalMs = config.runs.sweepIntervalMs,
  ) {
    this.sweepTimer = setInterval(() => this.sweep(), sweepIntervalMs);
    this.sweepTimer.unref?.();
  }

  create(agentId: string, input: unknown, initialStatus: RunStatus): RunRecord {
    const now = new Date().toISOString();
    const record: RunRecord = {
      run_id: randomUUID(),
      agent_id: agentId,
      status: initialStatus,
      input,
      created_at: now,
      updated_at: now,
    };
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0);
    this.runs.set(record.run_id, { record, emitter, history: [], controller: new AbortController(), listenerCount: 0 });
    return record;
  }

  get(runId: string): RunRecord | undefined {
    return this.runs.get(runId)?.record;
  }

  getSignal(runId: string): AbortSignal | undefined {
    return this.runs.get(runId)?.controller.signal;
  }

  /** Applies a RunEvent to a run's stored state, buffers it, and fans it out to any attached SSE listeners. */
  emitEvent(runId: string, event: RunEvent): void {
    const entry = this.runs.get(runId);
    if (!entry) return;

    switch (event.status) {
      case "running":
        entry.record.status = "running";
        break;
      case "complete":
        entry.record.status = "complete";
        entry.record.output = event.output;
        break;
      case "failed":
        entry.record.status = "failed";
        entry.record.error = event.error;
        break;
      case "cancelled":
        entry.record.status = "cancelled";
        break;
    }
    entry.record.updated_at = new Date().toISOString();

    entry.history.push(event);
    if (entry.history.length > HISTORY_LIMIT) entry.history.shift();

    entry.emitter.emit("event", event);
  }

  /** Marks a run cancelled (aborts its RunContext.signal) unless it's already terminal. Idempotent. */
  cancel(runId: string): void {
    const entry = this.runs.get(runId);
    if (!entry || TERMINAL.has(entry.record.status)) return;
    entry.controller.abort();
    this.emitEvent(runId, { status: "cancelled" });
  }

  /**
   * Subscribes to events for a run: replays buffered history synchronously
   * (so a client that connects moments after POST /runs doesn't miss
   * anything), then attaches `cb` for future events. Returns an
   * unsubscribe function, or undefined if the run doesn't exist.
   */
  subscribe(runId: string, cb: (event: RunEvent) => void): (() => void) | undefined {
    const entry = this.runs.get(runId);
    if (!entry) return undefined;

    for (const event of entry.history) cb(event);

    entry.emitter.on("event", cb);
    entry.listenerCount += 1;
    return () => {
      entry.emitter.off("event", cb);
      entry.listenerCount = Math.max(0, entry.listenerCount - 1);
    };
  }

  hasListeners(runId: string): boolean {
    return (this.runs.get(runId)?.listenerCount ?? 0) > 0;
  }

  private sweep(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, entry] of this.runs) {
      if (!TERMINAL.has(entry.record.status)) continue;
      if (new Date(entry.record.updated_at).getTime() < cutoff) {
        entry.emitter.removeAllListeners();
        this.runs.delete(id);
      }
    }
  }

  /** Stops the TTL sweep interval (used by tests / graceful shutdown). */
  destroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }
}

export const runStore = new RunStore();
