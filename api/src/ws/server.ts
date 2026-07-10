/**
 * ws/server.ts — the `/ws` WebSocket endpoint (spec: "WebSocket API").
 * Single persistent socket per agent: auth handshake, channel
 * subscribe/unsubscribe, server-pushed events fanned out from Redis
 * (services/broker.ts), and bidirectional RPC (ws/rpc.ts).
 */
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import {
  wsClientMessageSchema,
  type WsChannel,
  type WsClientMessage,
} from "@agentfund/shared";
import { verifyWsToken } from "./auth.js";
import { channelRegistry } from "./subscriptions.js";
import { handleRpc, RpcError, type RpcContext } from "./rpc.js";
import { broker, type BrokerEvent } from "../services/broker.js";

interface SocketState extends RpcContext {
  socket: WebSocket;
}

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

export function registerWebSocketServer(app: FastifyInstance): void {
  const states = new WeakMap<WebSocket, SocketState>();

  const forward = (event: BrokerEvent): void => {
    for (const socket of channelRegistry.socketsFor(event.channel)) {
      send(socket, event.payload);
    }
  };
  const unsubscribeBroker = broker.onEvent(forward);
  app.addHook("onClose", async () => unsubscribeBroker());

  app.get("/ws", { websocket: true }, (socket: WebSocket) => {
    const state: SocketState = { socket };
    states.set(socket, state);

    socket.on("message", (raw: Buffer) => {
      void (async () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          send(socket, { type: "error", error: { code: "invalid_json", message: "Message must be valid JSON" } });
          return;
        }

        const result = wsClientMessageSchema.safeParse(parsed);
        if (!result.success) {
          send(socket, { type: "error", error: { code: "invalid_message", message: result.error.message } });
          return;
        }
        await handleMessage(app, state, result.data);
      })();
    });

    socket.on("close", () => {
      channelRegistry.removeSocketEverywhere(socket);
      states.delete(socket);
    });
  });
}

async function handleMessage(app: FastifyInstance, state: SocketState, message: WsClientMessage): Promise<void> {
  switch (message.type) {
    case "auth": {
      try {
        const { wallet } = await verifyWsToken(app, message.token);
        state.wallet = wallet;
        send(state.socket, { type: "auth_ok", agent: wallet });
      } catch {
        send(state.socket, { type: "error", error: { code: "invalid_token", message: "JWT verification failed" } });
      }
      return;
    }

    case "subscribe": {
      await Promise.all(message.channels.map((c: WsChannel) => channelRegistry.subscribe(c, state.socket)));
      send(state.socket, { type: "subscribed", channels: message.channels });
      return;
    }

    case "unsubscribe": {
      await Promise.all(message.channels.map((c: WsChannel) => channelRegistry.unsubscribe(c, state.socket)));
      send(state.socket, { type: "unsubscribed", channels: message.channels });
      return;
    }

    case "rpc": {
      try {
        const result = await handleRpc(message.method, message.params, state);
        send(state.socket, { id: message.id, type: "rpc_result", result });
      } catch (err) {
        const code = err instanceof RpcError ? err.code : "internal_error";
        const errMessage = err instanceof Error ? err.message : "Unknown error";
        send(state.socket, { id: message.id, type: "rpc_error", error: { code, message: errMessage } });
      }
      return;
    }
  }
}
