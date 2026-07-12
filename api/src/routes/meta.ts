/**
 * routes/meta.ts — platform stats, the OpenAPI JSON document, and the
 * SSE fallback event stream (spec: "Discovery & Meta" §
 * GET /stats, GET /openapi.json, GET /events/stream).
 */
import type { FastifyInstance } from "fastify";
import { ProjectStatus, resolveUsdcMint } from "@agentfund/shared";
import { prisma } from "../lib/prisma.js";
import { broker, type BrokerEvent } from "../services/broker.js";

const DEFAULT_SSE_CHANNELS = ["projects", "contributions", "votes"] as const;

export function registerMetaRoutes(app: FastifyInstance): void {
  app.get("/stats", async (_request, reply) => {
    // Exclude untitled/broken projects (title === "" — see
    // routes/projects.ts's VISIBLE_PROJECT_WHERE) from every aggregate.
    // These never resolved real metadata and aren't legitimate campaigns,
    // so their raisedAmount shouldn't inflate the platform-wide total that
    // humans see on the dashboard.
    const visibleProject = { title: { not: "" } };
    const [raisedByMint, activeProjects, agentCount, txCount] = await Promise.all([
      prisma.project.groupBy({ by: ["tokenMint"], _sum: { raisedAmount: true }, where: visibleProject }),
      prisma.project.count({ where: { status: ProjectStatus.Active, ...visibleProject } }),
      prisma.agent.count(),
      prisma.indexedEvent.count(),
    ]);

    const usdcMint = resolveUsdcMint();
    const totalRaisedByToken: Record<string, number> = {};
    let totalRaised = 0;
    for (const row of raisedByMint) {
      const sum = Number(row._sum.raisedAmount ?? 0n);
      totalRaisedByToken[row.tokenMint] = sum;
      if (row.tokenMint === usdcMint) totalRaised += sum;
    }

    return reply.send({
      totalRaised,
      totalRaisedByToken,
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
