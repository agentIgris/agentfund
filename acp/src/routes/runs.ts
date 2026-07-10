/**
 * routes/runs.ts — the IBM ACP open REST run lifecycle (spec: "ACP
 * Message Flow"):
 *
 *   POST   /runs              { agent_id, input } -> creates a run.
 *                              Sync agents (manifest.async === false)
 *                              respond inline with the finished run
 *                              (status "complete"/"failed" + output).
 *                              Async agents respond immediately with
 *                              status "running" + run_id; the caller
 *                              follows up with GET /runs/:id (poll) or
 *                              GET /runs/:id/events (SSE).
 *   GET    /runs/:id           -> current run status/output snapshot.
 *   GET    /runs/:id/events    -> SSE stream of RunEvents, replaying
 *                              buffered history first so a client that
 *                              connects slightly after POST /runs still
 *                              sees everything.
 */
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { agentRegistry } from "../agents/index.js";
import { runStore } from "../runs/run-store.js";
import { startRun } from "../runs/executor.js";
import { createRunRequestSchema, runIdParamSchema } from "../schemas.js";
import type { RunEvent, RunRecord } from "../types.js";

function serializeRun(run: RunRecord) {
  return {
    run_id: run.run_id,
    agent_id: run.agent_id,
    status: run.status,
    input: run.input,
    output: run.output,
    error: run.error,
    created_at: run.created_at,
    updated_at: run.updated_at,
  };
}

export function registerRunRoutes(app: FastifyInstance): void {
  app.post("/runs", async (request, reply) => {
    const envelope = createRunRequestSchema.safeParse(request.body);
    if (!envelope.success) {
      return reply.code(400).send({ error: "invalid_request", details: envelope.error.flatten() });
    }
    const { agent_id, input } = envelope.data;

    const def = agentRegistry[agent_id];
    if (!def) {
      return reply.code(404).send({
        error: "agent_not_found",
        message: `Unknown agent_id "${agent_id}". See GET /agents for the list of delegate-able agents.`,
      });
    }

    const parsedInput = def.inputSchema.safeParse(input);
    if (!parsedInput.success) {
      return reply.code(400).send({ error: "invalid_input", details: parsedInput.error.flatten() });
    }

    const run = runStore.create(agent_id, parsedInput.data, "pending");

    try {
      // Sync agents: startRun awaits full execution, so `run` reflects
      // the terminal state by the time we respond ("respond inline").
      // Async agents: startRun emits "running" and returns immediately
      // without awaiting the agent's own execute() promise.
      await startRun(def, run, parsedInput.data);
    } catch (err) {
      // Defensive: startRun's internal runAgent() already catches agent
      // errors into a "failed" RunEvent; this only fires on a bug in
      // startRun/runStore itself.
      request.log.error({ err, run_id: run.run_id }, "unexpected error starting run");
    }

    const latest = runStore.get(run.run_id) ?? run;
    const statusCode = def.manifest.async ? 202 : latest.status === "failed" ? 502 : 200;
    return reply.code(statusCode).send(serializeRun(latest));
  });

  app.get("/runs/:id", async (request, reply) => {
    const params = runIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });

    const run = runStore.get(params.data.id);
    if (!run) return reply.code(404).send({ error: "run_not_found" });
    return reply.send(serializeRun(run));
  });

  app.get("/runs/:id/events", async (request, reply) => {
    const params = runIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const runId = params.data.id;

    if (!runStore.get(runId)) {
      return reply.code(404).send({ error: "run_not_found" });
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    reply.raw.write(": connected\n\n");

    const send = (event: RunEvent) => {
      reply.raw.write(`event: ${event.status}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    const unsubscribe = runStore.subscribe(runId, send);
    // unsubscribe is only undefined if the run vanished (TTL-swept)
    // between the existence check above and this call — vanishingly
    // unlikely, but handled by simply ending the stream.
    if (!unsubscribe) {
      reply.raw.end();
      return;
    }

    const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), config.runs.sseHeartbeatMs);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      // Only cancel on an actual disconnect of a previously-attached
      // listener (not merely "nobody ever connected") — this is what
      // lets MonitorAgent run "until client disconnect" (spec) while
      // still allowing async agents to run to completion when nobody
      // bothers to open the SSE stream at all.
      if (!runStore.hasListeners(runId)) {
        runStore.cancel(runId);
      }
    });
  });
}
