/**
 * Redis pub/sub event broker. A single shared publisher connection plus
 * one dedicated subscriber connection (ioredis requires a connection in
 * subscriber mode to be used exclusively for that). Every fanout path in
 * the app — the indexer, the WS server, and the SSE stream — goes
 * through this module so there is exactly one Redis subscription per
 * process no matter how many WS clients / SSE clients are attached.
 */
import { Redis } from "ioredis";
import { config } from "../config.js";

export const CHANNEL_PREFIX = "agentfund:events";

/** Builds the Redis pub/sub channel name for a logical WS channel. */
export function redisChannelFor(channel: string): string {
  return `${CHANNEL_PREFIX}:${channel}`;
}

export type BrokerEvent = {
  /** Logical channel this event belongs to, e.g. "projects", "project:<id>". */
  channel: string;
  /** Event envelope — matches the WsServerEvent shapes from @agentfund/shared. */
  payload: Record<string, unknown>;
};

type Listener = (event: BrokerEvent) => void;

class Broker {
  private pub = new Redis(config.redis.url, { lazyConnect: true, maxRetriesPerRequest: null });
  private sub = new Redis(config.redis.url, { lazyConnect: true, maxRetriesPerRequest: null });
  private listeners = new Set<Listener>();
  private subscribedChannels = new Set<string>();
  private started = false;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await Promise.all([this.pub.connect(), this.sub.connect()]);
    this.sub.on("message", (redisChannel, raw) => {
      const channel = redisChannel.slice(CHANNEL_PREFIX.length + 1);
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      for (const listener of this.listeners) listener({ channel, payload });
    });
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    await Promise.allSettled([this.pub.quit(), this.sub.quit()]);
  }

  /** Publishes an event to a logical channel (e.g. "projects", "project:<id>"). */
  async publish(channel: string, payload: Record<string, unknown>): Promise<void> {
    await this.pub.publish(redisChannelFor(channel), JSON.stringify(payload));
  }

  /** Subscribes the process-wide Redis connection to a logical channel. */
  async subscribeChannel(channel: string): Promise<void> {
    if (this.subscribedChannels.has(channel)) return;
    this.subscribedChannels.add(channel);
    await this.sub.subscribe(redisChannelFor(channel));
  }

  async unsubscribeChannel(channel: string): Promise<void> {
    if (!this.subscribedChannels.has(channel)) return;
    this.subscribedChannels.delete(channel);
    await this.sub.unsubscribe(redisChannelFor(channel));
  }

  /** Registers a local (in-process) listener for all subscribed channels. */
  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Raw ioredis client, e.g. for BullMQ connection reuse or nonce storage. */
  get connection(): Redis {
    return this.pub;
  }
}

export const broker = new Broker();
