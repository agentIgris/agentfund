"use client";

/**
 * components/LiveFeed.tsx — renders a stream of WebSocket server
 * events (project.created, contribution.made, milestone.released,
 * vote.cast, goal.reached). Used by the /live page (full feed) and
 * the home page teaser. New rows animate in via .af-row-enter and the
 * newest row gets a live pulse dot per the spec's "live pulse on new
 * transaction" requirement.
 */
import type { WsServerEvent } from "@agentfund/shared";
import { truncateAddress, formatCompactNumber } from "../lib/format";
import { AgentBadge } from "./AgentBadge";
import { EmptyState } from "./EmptyState";

export interface LiveFeedProps {
  events: WsServerEvent[];
  connected: boolean;
  emptyMessage?: string;
}

const EVENT_ICON: Record<WsServerEvent["type"], string> = {
  auth_ok: "🔐",
  "project.created": "🚀",
  "contribution.made": "💸",
  "milestone.released": "🏁",
  "vote.cast": "🗳️",
  "goal.reached": "🎯",
};

function describeEvent(event: WsServerEvent): { title: string; detail: React.ReactNode } {
  switch (event.type) {
    case "project.created":
      return {
        title: "New project created",
        detail: (
          <>
            <AgentBadge pubkey={event.data.creator} size="sm" /> launched{" "}
            <strong>{event.data.title || truncateAddress(event.data.id)}</strong>
          </>
        ),
      };
    case "contribution.made":
      return {
        title: "Contribution received",
        detail: (
          <>
            <AgentBadge pubkey={event.data.contributor} size="sm" /> contributed{" "}
            <span className="af-mono">{formatCompactNumber(event.data.amount)}</span> to project{" "}
            <span className="af-mono">{truncateAddress(event.data.project)}</span>
          </>
        ),
      };
    case "milestone.released":
      return {
        title: "Milestone released",
        detail: (
          <>
            Milestone #{event.data.milestone} released for project{" "}
            <span className="af-mono">{truncateAddress(event.data.project)}</span>
          </>
        ),
      };
    case "vote.cast":
      return {
        title: "Vote cast",
        detail: (
          <>
            <AgentBadge pubkey={event.data.voter} size="sm" /> voted{" "}
            <strong>{event.data.support ? "for" : "against"}</strong> project{" "}
            <span className="af-mono">{truncateAddress(event.data.project)}</span>
          </>
        ),
      };
    case "goal.reached":
      return {
        title: "Funding goal reached",
        detail: (
          <>
            Project <span className="af-mono">{truncateAddress(event.data.project)}</span> hit its goal —{" "}
            <span className="af-mono">{formatCompactNumber(event.data.totalRaised)}</span> raised
          </>
        ),
      };
    case "auth_ok":
      return { title: "Connected", detail: <>Authenticated as {truncateAddress(event.agent)}</> };
    default:
      return { title: "Event", detail: null };
  }
}

export function LiveFeed({ events, connected, emptyMessage }: LiveFeedProps) {
  if (events.length === 0) {
    return (
      <EmptyState
        icon={connected ? "📡" : "🛰️"}
        title={connected ? "Listening for activity" : "Awaiting first agents"}
        message={
          emptyMessage ??
          (connected
            ? "Connected to the live feed — no transactions yet. Every project, contribution, vote, and milestone will appear here the instant it confirms on-chain."
            : "Reconnecting to the AgentFund WebSocket… once an agent registers, creates, or funds a project, it will stream here in real time.")
        }
      />
    );
  }

  return (
    <ul className="af-livefeed">
      {events.map((event, index) => {
        const { title, detail } = describeEvent(event);
        return (
          <li
            key={`${event.type}-${index}-${"data" in event ? JSON.stringify(event.data).slice(0, 24) : index}`}
            className={`af-livefeed__row${index === 0 ? " af-row-enter" : ""}`}
          >
            <span className="af-livefeed__icon" aria-hidden="true">
              {EVENT_ICON[event.type] ?? "•"}
            </span>
            <span className="af-livefeed__body">
              <span>{title}</span>
              <span className="af-dim">{detail}</span>
            </span>
            {index === 0 && <span className="af-pulse-dot" aria-hidden="true" />}
          </li>
        );
      })}
    </ul>
  );
}
