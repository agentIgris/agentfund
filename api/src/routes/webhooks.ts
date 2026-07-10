/**
 * routes/webhooks.ts — agent webhook registration (spec: `POST
 * /webhooks`) plus the BullMQ-backed delivery pipeline that fans out
 * every broker event (services/broker.ts) to matching, active
 * registrations. Each delivery is HMAC-signed
 * (`X-AgentFund-Signature: sha256=<hex>`) over the raw JSON body so
 * receivers can verify authenticity.
 */
import { createHmac, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Queue, Worker, type RedisOptions } from "bullmq";
import { Redis as IORedis } from "ioredis";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { broker, type BrokerEvent } from "../services/broker.js";
import { registerWebhookBodySchema } from "../schema/webhooks.js";

// `RedisOptions` (not bullmq's broader `ConnectionOptions` union, which also
// admits pre-built `Redis`/`Cluster` instances) is what the `IORedis`
// constructor below actually accepts.
const connectionOptions: RedisOptions = { maxRetriesPerRequest: null };

let queue: Queue | undefined;
let worker: Worker | undefined;

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(config.webhooks.queueName, {
      connection: new IORedis(config.redis.url, connectionOptions),
    });
  }
  return queue;
}

interface WebhookDeliveryJob {
  webhookId: string;
  url: string;
  secret: string;
  event: BrokerEvent["payload"];
}

function sign(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Starts the BullMQ worker that actually POSTs to registered callback URLs. Call once at boot. */
export function startWebhookDeliveryWorker(): Worker {
  if (worker) return worker;
  worker = new Worker<WebhookDeliveryJob>(
    config.webhooks.queueName,
    async (job) => {
      const { url, secret, event } = job.data;
      const body = JSON.stringify(event);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AgentFund-Signature": sign(secret, body),
          "X-AgentFund-Event": String((event as { type?: string }).type ?? "unknown"),
        },
        body,
      });
      if (!res.ok) {
        throw new Error(`webhook delivery to ${url} failed with status ${res.status}`);
      }
    },
    {
      connection: new IORedis(config.redis.url, connectionOptions),
      concurrency: 10,
    },
  );
  return worker;
}

/** Subscribes the process to broker events and enqueues deliveries for every matching active webhook. Call once at boot. */
export function startWebhookDispatcher(): () => void {
  return broker.onEvent((event: BrokerEvent) => {
    void dispatchEventToWebhooks(event).catch(() => undefined);
  });
}

async function dispatchEventToWebhooks(event: BrokerEvent): Promise<void> {
  const registrations = await prisma.webhookRegistration.findMany({
    where: { active: true, events: { has: event.channel } },
  });
  if (registrations.length === 0) return;

  const q = getQueue();
  await Promise.all(
    registrations.map((reg) =>
      q.add(
        "deliver",
        { webhookId: reg.id, url: reg.url, secret: reg.secret, event: event.payload } satisfies WebhookDeliveryJob,
        { attempts: config.webhooks.maxAttempts, backoff: { type: "exponential", delay: 2000 } },
      ),
    ),
  );
}

export function registerWebhookRoutes(app: FastifyInstance): void {
  app.post("/webhooks", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = registerWebhookBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const body = parsed.data;
    const secret = body.secret ?? randomBytes(24).toString("hex");

    const registration = await prisma.webhookRegistration.create({
      data: {
        agentWallet: request.agentWallet!,
        url: body.url,
        secret,
        events: body.events,
      },
    });

    // Make sure the broker is actually subscribed (via Redis) to any
    // per-project channel this webhook cares about — "projects",
    // "contributions", "votes" are subscribed unconditionally at boot.
    await Promise.all(
      body.events.filter((e) => e.startsWith("project:")).map((e) => broker.subscribeChannel(e)),
    );

    return reply.code(201).send({
      id: registration.id,
      url: registration.url,
      events: registration.events,
      // Echoed back once at registration time only — not retrievable afterward.
      secret,
    });
  });

  app.get("/webhooks", { preHandler: requireAuth }, async (request, reply) => {
    const registrations = await prisma.webhookRegistration.findMany({
      where: { agentWallet: request.agentWallet! },
      select: { id: true, url: true, events: true, active: true, createdAt: true },
    });
    return reply.send({ webhooks: registrations });
  });
}
