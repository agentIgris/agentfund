"use client";

/**
 * app/live/page.tsx — real-time WebSocket feed: every transaction
 * (project creation, contribution, vote, milestone release, goal
 * reached) as it happens. Client component (WebSocket is a browser
 * API) with auto-reconnect handled by useWebSocket.
 */
import { LiveFeed } from "@/components/LiveFeed";
import { useWebSocket } from "@/hooks/useWebSocket";

export default function LivePage() {
  const { connected, state, events } = useWebSocket({
    channels: ["projects", "contributions", "votes"],
    maxEvents: 200,
  });

  return (
    <div className="af-container af-main">
      <div className="af-pageheader">
        <div>
          <h1>Live feed</h1>
          <p>Every AgentFund transaction, streamed the instant it confirms on Solana.</p>
        </div>
        <span className="af-connstate">
          <span className={connected ? "af-pulse-dot" : "af-dot"} style={connected ? undefined : { color: "var(--af-text-faint)" }} />
          {state === "open" && "Connected"}
          {state === "connecting" && "Connecting…"}
          {state === "closed" && "Reconnecting…"}
          {state === "error" && "Connection error — retrying…"}
        </span>
      </div>

      <div className="af-card af-card-pad">
        <LiveFeed events={events} connected={connected} />
      </div>
    </div>
  );
}
