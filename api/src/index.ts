/**
 * src/index.ts — AgentFund API bootstrap. Wires up Fastify (REST + WS),
 * Redis pub/sub (services/broker.ts), the BullMQ webhook delivery
 * worker, and graceful shutdown.
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import swagger from "@fastify/swagger";
import { config, assertProductionConfig } from "./config.js";
import { prisma } from "./lib/prisma.js";
import { broker } from "./services/broker.js";
import { registerHeliusWebhook } from "./services/helius.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerTxRoutes } from "./routes/tx.js";
import { registerX402Routes } from "./routes/x402.js";
import { registerWebhookRoutes, startWebhookDeliveryWorker, startWebhookDispatcher } from "./routes/webhooks.js";
import { registerMetaRoutes } from "./routes/meta.js";
import { registerWellKnownRoutes } from "./routes/wellKnown.js";
import { registerWebSocketServer } from "./ws/server.js";

const DEFAULT_BROKER_CHANNELS = ["projects", "contributions", "votes"] as const;

export async function buildApp() {
  // Crash loudly on an insecure production config before binding the port.
  assertProductionConfig();

  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport: config.isProduction ? undefined : { target: "pino-pretty" },
    },
    trustProxy: true,
  });

  await app.register(cors, { origin: config.corsOrigin === "*" ? true : config.corsOrigin.split(",") });

  await app.register(jwt, { secret: config.auth.jwtSecret });

  await app.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
    // Rate-limit per authenticated wallet when present, else per IP (spec: "100 req/min per wallet/IP").
    keyGenerator: (request) => {
      const auth = request.headers.authorization;
      if (auth?.startsWith("Bearer ")) {
        try {
          const payload = app.jwt.decode<{ wallet: string }>(auth.slice("Bearer ".length));
          if (payload?.wallet) return `wallet:${payload.wallet}`;
        } catch {
          // fall through to IP-based limiting
        }
      }
      return `ip:${request.ip}`;
    },
  });

  await app.register(websocket);

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "AgentFund API",
        description: "Fundraising and donation platform for AI agents on Solana.",
        version: "1.0.0",
      },
      servers: [
        { url: "https://api.agentfund.online", description: "Production" },
        { url: config.apiBaseUrl, description: "Local development" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    },
  });

  registerWellKnownRoutes(app);
  registerAuthRoutes(app);
  registerProjectRoutes(app);
  registerAgentRoutes(app);
  registerTxRoutes(app);
  registerX402Routes(app);
  registerWebhookRoutes(app);
  registerMetaRoutes(app);
  registerHeliusWebhook(app);
  registerWebSocketServer(app);

  app.get("/health", async () => ({ ok: true }));

  return app;
}

async function main() {
  const app = await buildApp();

  await broker.start();
  await Promise.all(DEFAULT_BROKER_CHANNELS.map((c) => broker.subscribeChannel(c)));

  const webhookWorker = startWebhookDeliveryWorker();
  const stopWebhookDispatcher = startWebhookDispatcher();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutting down gracefully");
    try {
      stopWebhookDispatcher();
      await webhookWorker.close();
      await app.close();
      await broker.stop();
      await prisma.$disconnect();
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
