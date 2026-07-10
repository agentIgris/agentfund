"use client";

/**
 * hooks/useWebSocket.ts — persistent connection to the AgentFund
 * WebSocket API (NEXT_PUBLIC_WS_URL) with auto-reconnect + backoff.
 * Subscribes to the given channels on connect and accumulates the
 * most recent server-pushed events. Used by /live and StatsBar.
 *
 * Message shapes mirror shared/src/types.ts (WsServerEvent, WsChannel).
 */
import { useEffect, useRef, useState } from "react";
import type { WsChannel, WsServerEvent } from "@agentfund/shared";

export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000/ws";

export type WsConnectionState = "connecting" | "open" | "closed" | "error";

export interface UseWebSocketOptions {
  /** Channels to subscribe to once the socket opens. */
  channels?: WsChannel[];
  /** Max number of recent events retained (newest first). Default 100. */
  maxEvents?: number;
  /** Set false to skip connecting (e.g. during SSR-safety checks). */
  enabled?: boolean;
}

export interface UseWebSocketResult {
  state: WsConnectionState;
  connected: boolean;
  events: WsServerEvent[];
  lastEvent: WsServerEvent | null;
}

const MAX_BACKOFF_MS = 30_000;

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketResult {
  const { channels = ["projects", "contributions", "votes"], maxEvents = 100, enabled = true } = options;
  const channelsKey = channels.join(",");

  const [state, setState] = useState<WsConnectionState>("connecting");
  const [events, setEvents] = useState<WsServerEvent[]>([]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;

    let cancelled = false;
    let socket: WebSocket | null = null;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      setState("connecting");

      try {
        socket = new WebSocket(WS_URL);
      } catch {
        setState("error");
        scheduleReconnect();
        return;
      }

      socket.onopen = () => {
        if (cancelled) return;
        attempt = 0;
        setState("open");
        socket?.send(JSON.stringify({ type: "subscribe", channels: channelsKey.split(",") }));
      };

      socket.onmessage = (event) => {
        if (cancelled) return;
        let parsed: WsServerEvent | null = null;
        try {
          parsed = JSON.parse(event.data as string) as WsServerEvent;
        } catch {
          return;
        }
        // Ignore protocol acks that aren't feed events worth displaying.
        if (!parsed || typeof parsed.type !== "string") return;
        setEvents((prev) => [parsed as WsServerEvent, ...prev].slice(0, maxEvents));
      };

      socket.onclose = () => {
        if (cancelled) return;
        setState("closed");
        scheduleReconnect();
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    const scheduleReconnect = () => {
      attempt += 1;
      const delay = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
      reconnectTimer = setTimeout(connect, delay);
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelsKey, enabled, maxEvents]);

  return {
    state,
    connected: state === "open",
    events,
    lastEvent: events[0] ?? null,
  };
}
