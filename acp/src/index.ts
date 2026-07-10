/**
 * src/index.ts — AgentFund ACP server bootstrap (spec: "ACP Server").
 * Fastify app exposing the IBM ACP open REST pattern: GET /agents,
 * POST /runs, GET /runs/:id, GET /runs/:id/events — backed by the 4
 * delegate-able agents in src/agents/index.ts, which themselves proxy to
 * the @agentfund/api REST API (API_BASE_URL).
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { config } from "./config.js";
import { runStore } from "./runs/run-store.js";
import { registerAgentManifestRoutes } from "./routes/agents.js";
import { registerRunRoutes } from "./routes/runs.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport: config.isProduction ? undefined : { target: "pino-pretty" },
    },
    trustProxy: true,
  });

  await app.register(cors, { origin: config.corsOrigin === "*" ? true : config.corsOrigin.split(",") });
  await app.register(sensible);

  registerAgentManifestRoutes(app);
  registerRunRoutes(app);

  app.get("/health", async () => ({ ok: true, service: config.server.name, version: config.server.version }));

  return app;
}

async function main() {
  const app = await buildApp();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutting down gracefully");
    try {
      await app.close();
      runStore.destroy();
    } catch (err) {
      app.log.error({ err }, "error during shutdown");
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("fatal startup error", err);
  process.exit(1);
});
