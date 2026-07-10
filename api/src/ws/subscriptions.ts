/**
 * ws/subscriptions.ts — per-channel socket registry. Reference-counts
 * how many live sockets care about each logical channel so the process
 * subscribes/unsubscribes the underlying Redis connection
 * (services/broker.ts) exactly once no matter how many WS clients
 * overlap on the same channel.
 */
import type { WebSocket } from "ws";
import { broker } from "../services/broker.js";

class ChannelRegistry {
  private socketsByChannel = new Map<string, Set<WebSocket>>();

  async subscribe(channel: string, socket: WebSocket): Promise<void> {
    let sockets = this.socketsByChannel.get(channel);
    if (!sockets) {
      sockets = new Set();
      this.socketsByChannel.set(channel, sockets);
    }
    if (sockets.has(socket)) return;
    const wasEmpty = sockets.size === 0;
    sockets.add(socket);
    if (wasEmpty) await broker.subscribeChannel(channel);
  }

  async unsubscribe(channel: string, socket: WebSocket): Promise<void> {
    const sockets = this.socketsByChannel.get(channel);
    if (!sockets?.has(socket)) return;
    sockets.delete(socket);
    if (sockets.size === 0) {
      this.socketsByChannel.delete(channel);
      await broker.unsubscribeChannel(channel);
    }
  }

  /** Removes a disconnected socket from every channel it was subscribed to. */
  removeSocketEverywhere(socket: WebSocket): void {
    for (const channel of [...this.socketsByChannel.keys()]) {
      void this.unsubscribe(channel, socket);
    }
  }

  socketsFor(channel: string): ReadonlySet<WebSocket> {
    return this.socketsByChannel.get(channel) ?? new Set();
  }
}

export const channelRegistry = new ChannelRegistry();
