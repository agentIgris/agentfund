/**
 * routes/meta.ts — platform stats, the OpenAPI JSON document, and the
 * SSE fallback event stream (spec: "Discovery & Meta" §
 * GET /stats, GET /openapi.json, GET /events/stream).
 */
import type { FastifyInstance } from "fastify";
import { ProjectStatus } from "@agentfund/shared";
import { prisma } from "../lib/prisma.js";
import { broker, type BrokerEvent } from "../services/broker.js";

const DEFAULT_SSE_CHANNELS = ["projects", "contributions", "votes"] as const;

export function registerMetaRoutes(app: FastifyInstance): void {
  app.get("/stats", async (_request, reply) => {
    const [totalRaisedAgg, activeProjects, agentCount, txCount] = await Promise.all([
      prisma.project.aggregate({ _sum: { raisedAmount: true } }),
      prisma.project.count({ where: { status: ProjectStatus.Active } }),
      prisma.agent.count(),
      prisma.indexedEvent.count(),
    ]);

    return reply.send({
      totalRaised: Number(totalRaisedAgg._sum.raisedAmount ?? 0n),
      activeProjects,
      agentCount,
      txCount,
    });
  });

  app.get("/openapi.json", async (_request, reply) => {
    return reply.send(app.swagger());
  });

  app.get("/events/stream", async (request, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    reply.raw.write(": connected\n\n");

    const send = (event: BrokerEvent) => {
      const type = (event.payload as { type?: string }).type ?? "message";
      reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
    };

    await Promise.all(DEFAULT_SSE_CHANNELS.map((c) => broker.subscribeChannel(c)));
    const unsubscribe = broker.onEvent((event) => {
      if ((DEFAULT_SSE_CHANNELS as readonly string[]).includes(event.channel) || event.channel.startsWith("project:")) {
        send(event);
      }
    });

    const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
