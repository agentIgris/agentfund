/**
 * WebSocket subscription helper (spec: "WebSocket API"). Wraps a single
 * persistent connection to `wss://api.../ws`: sends the `auth` handshake
 * (if a JWT is available), subscribes to the requested channels, and
 * transparently reconnects with exponential backoff — resubscribing (and
 * re-authenticating) automatically whenever the socket drops. Agents
 * never have to think about connection lifecycle; they just get a
 * stream of events until they call the returned `unsubscribe()`.
 */
import WebSocket from "ws";
import type { WsChannel, WsServerEvent } from "@agentfund/shared";

/**
 * Every message the server pushes, per the spec's WebSocket API section
 * (`project.created`, `contribution.made`, `milestone.released`,
 * `vote.cast`, `goal.reached`, plus the `auth_ok` handshake ack). The
 * server may also emit lightweight transport acks (e.g. `subscribed`,
 * `unsubscribed`) that aren't part of the documented event set — those
 * still arrive at `handler` at runtime, just outside this type; switch
 * on `event.type` and ignore anything you don't recognize.
 */
export type AgentFundWsEvent = WsServerEvent;

export type AgentFundWsHandler = (event: AgentFundWsEvent) => void;

export interface SubscribeOptions {
  /** Called whenever the socket (re)connects, right before subscribing. Useful for logging. */
  onConnect?: () => void;
  /** Called whenever the socket closes (before a reconnect attempt is scheduled). */
  onDisconnect?: (reason: { code: number; reason: string }) => void;
  /** Called on socket-level errors (parse errors, connection failures). Never throws out of the socket handlers. */
  onError?: (err: Error) => void;
  /** Minimum backoff between reconnect attempts, in ms. Default 500. */
  minBackoffMs?: number;
  /** Maximum backoff between reconnect attempts, in ms. Default 30000. */
  maxBackoffMs?: number;
}

export type Unsubscribe = () => void;

/**
 * Opens a resilient subscription to `wsUrl`. `getToken` is called fresh
 * on every (re)connect so a token obtained/refreshed after `subscribe()`
 * was first called (or after `authenticate()` runs later) is still
 * picked up.
 */
export function openSubscription(
  wsUrl: string,
  channels: WsChannel[],
  handler: AgentFundWsHandler,
  getToken: () => string | undefined,
  opts: SubscribeOptions = {},
): Unsubscribe {
  const minBackoff = opts.minBackoffMs ?? 500;
  const maxBackoff = opts.maxBackoffMs ?? 30_000;

  let closedByCaller = false;
  let socket: WebSocket | undefined;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  const scheduleReconnect = (): void => {
    if (closedByCaller) return;
    const delay = Math.min(maxBackoff, minBackoff * 2 ** reconnectAttempt);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(connect, delay);
  };

  function connect(): void {
    if (closedByCaller) return;
    socket = new WebSocket(wsUrl);

    socket.on("open", () => {
      reconnectAttempt = 0;
      opts.onConnect?.();
      const token = getToken();
      if (token) {
        socket!.send(JSON.stringify({ type: "auth", token }));
      }
      socket!.send(JSON.stringify({ type: "subscribe", channels }));
    });

    socket.on("message", (raw: WebSocket.RawData) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        opts.onError?.(new Error("Received non-JSON WebSocket message"));
        return;
      }
      handler(parsed as AgentFundWsEvent);
    });

    socket.on("close", (code: number, reasonBuf: Buffer) => {
      opts.onDisconnect?.({ code, reason: reasonBuf.toString() });
      scheduleReconnect();
    });

    socket.on("error", (err: Error) => {
      opts.onError?.(err);
    });
  }

  connect();

  return () => {
    closedByCaller = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    socket?.close();
  };
}
