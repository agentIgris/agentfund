/**
 * MonitorAgent — spec: "Watches a project and streams events back to
 * caller via ACP". Delegate-able, async (manifest.async === true),
 * streaming: `output: stream<AgentEvent>`, no single final output.
 *
 * Implementation: "subscribes to the API WebSocket and re-emits matching
 * events on the run's SSE stream until client disconnect." This agent
 * opens exactly one `ws` connection per run to `${API_WS_URL}` (derived
 * from API_BASE_URL — see config.ts), subscribes to whichever logical
 * channels cover the caller's requested `events` filter, and forwards
 * every matching message as a `{ status: "running", output_chunk:
 * AgentEvent }` event via `ctx.emit` (GET /runs/:id/events streams these
 * out as SSE). The run only resolves once `ctx.signal` aborts — the run
 * store aborts it precisely when the SSE stream's last listener
 * disconnects (see run-store.ts's `hasListeners` / routes' close
 * handling), matching "until client disconnect" exactly.
 *
 * Event-filter -> channel/type mapping. AgentFund's WS protocol (see
 * api/src/services/indexer.ts's `broker.publish(...)` calls) does not
 * literally spell every spec filter name as a channel or event `type`,
 * so this is the translation this agent applies:
 *
 *   "milestone"     -> channel `project:<id>`, ws type "milestone.released"
 *   "goal_reached"  -> channel `projects`,     ws type "goal.reached"
 *   "vote"          -> channel `votes`,        ws type "vote.cast"
 *   "refund"        -> channel `project:<id>`, ws type "project.status_changed"
 *                       with data.status === "Failed" (this is what the
 *                       indexer publishes on the on-chain `Refunded` event
 *                       — there is no dedicated "refund" ws type today).
 *                       Re-labelled to `type: "refund"` in the emitted
 *                       AgentEvent so callers see the name they asked for.
 *
 * Every forwarded event is additionally filtered on `data.project ===
 * project_id` (the ws channels this agent subscribes to, e.g. `projects`
 * and `votes`, are platform-wide — not scoped to one project — so this
 * agent does the per-project filtering client-side).
 *
 * Resilience: if the upstream API WebSocket drops unexpectedly (not due
 * to run cancellation), this agent reconnects with linear backoff up to
 * MAX_RECONNECT_ATTEMPTS, emitting a "running" output_chunk describing
 * the reconnect so the caller's stream isn't silently stalled. It never
 * transitions the run to "failed" on its own for a transient WS issue —
 * only cancellation (client disconnect) ends the run.
 */
import WebSocket from "ws";
import { config } from "../config.js";
import type { AgentEvent, MonitorAgentInput } from "../schemas.js";
import type { AgentDefinition, RunContext } from "../types.js";
import { monitorAgentInputSchema } from "../schemas.js";
import { monitorAgentManifest } from "../manifests/agents.js";

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 2_000;

interface InboundWsEvent {
  type: string;
  data: Record<string, unknown>;
}

function isInboundWsEvent(value: unknown): value is InboundWsEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    typeof (value as { data?: unknown }).data === "object" &&
    (value as { data?: unknown }).data !== null
  );
}

/** Channels to subscribe to for a given set of requested event filters. */
function channelsFor(events: MonitorAgentInput["events"], projectId: string): string[] {
  const channels = new Set<string>();
  if (events.includes("milestone") || events.includes("refund")) channels.add(`project:${projectId}`);
  if (events.includes("goal_reached")) channels.add("projects");
  if (events.includes("vote")) channels.add("votes");
  return [...channels];
}

/** Maps one inbound ws message to an AgentEvent iff it matches a requested filter and this project. Returns undefined otherwise. */
function matchEvent(msg: InboundWsEvent, input: MonitorAgentInput): AgentEvent | undefined {
  const project = msg.data.project ?? msg.data.id;
  if (project !== input.project_id) return undefined;

  if (msg.type === "milestone.released" && input.events.includes("milestone")) {
    return { type: msg.type, data: msg.data };
  }
  if (msg.type === "goal.reached" && input.events.includes("goal_reached")) {
    return { type: msg.type, data: msg.data };
  }
  if (msg.type === "vote.cast" && input.events.includes("vote")) {
    return { type: msg.type, data: msg.data };
  }
  if (msg.type === "project.status_changed" && input.events.includes("refund") && msg.data.status === "Failed") {
    return { type: "refund", data: msg.data };
  }
  return undefined;
}

function execute(input: MonitorAgentInput, ctx: RunContext): Promise<unknown> {
  const channels = channelsFor(input.events, input.project_id);

  return new Promise((resolve) => {
    let aborted = false;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | undefined;

    const cleanup = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.removeAllListeners();
      if (socket && socket.readyState === WebSocket.OPEN) socket.close();
    };

    const connect = () => {
      socket = new WebSocket(config.apiWsUrl);

      socket.on("open", () => {
        reconnectAttempts = 0;
        socket?.send(JSON.stringify({ type: "subscribe", channels }));
      });

      socket.on("message", (raw) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (!isInboundWsEvent(parsed)) return;
        const event = matchEvent(parsed, input);
        if (event) ctx.emit({ status: "running", output_chunk: event });
      });

      socket.on("error", () => {
        // Swallow — the "close" handler (always fired after "error" for
        // ws) owns reconnect/backoff logic below.
      });

      socket.on("close", () => {
        if (aborted) return;
        reconnectAttempts += 1;
        if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
          ctx.emit({
            status: "running",
            output_chunk: {
              type: "monitor.disconnected",
              data: {
                message: `Lost connection to ${config.apiWsUrl} after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts; no longer watching project ${input.project_id}.`,
              },
            },
          });
          return;
        }
        ctx.emit({
          status: "running",
          output_chunk: {
            type: "monitor.reconnecting",
            data: { attempt: reconnectAttempts, project_id: input.project_id },
          },
        });
        reconnectTimer = setTimeout(connect, RECONNECT_BASE_DELAY_MS * reconnectAttempts);
      });
    };

    connect();

    ctx.signal.addEventListener(
      "abort",
      () => {
        aborted = true;
        cleanup();
        resolve(undefined);
      },
      { once: true },
    );
  });
}

export const monitorAgent: AgentDefinition<typeof monitorAgentInputSchema> = {
  manifest: monitorAgentManifest,
  inputSchema: monitorAgentInputSchema,
  execute,
};
