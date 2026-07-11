"use client";

/**
 * components/StatsBar.tsx — sticky top ticker showing live platform
 * stats (Total Raised, Active Projects, Agents Registered,
 * Transactions). Fetches an initial snapshot from GET /stats, then
 * keeps counters live by folding in WebSocket events (contribution,
 * project, vote, milestone) as they arrive — each updated value gets
 * a brief "bump" animation per the spec's live-pulse requirement.
 * Renders a calm placeholder row when the API/WS are unreachable.
 */
import { useEffect, useRef, useState } from "react";
import type { PlatformStats } from "@agentfund/shared";
import { getPlatformStats } from "../lib/api";
import { useWebSocket } from "../hooks/useWebSocket";
import { formatCompactNumber, formatCompactTotalRaised } from "../lib/format";

type StatKey = "totalRaised" | "activeProjects" | "agentCount" | "txCount";

export function StatsBar() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [bumped, setBumped] = useState<Partial<Record<StatKey, boolean>>>({});
  const bumpTimers = useRef<Partial<Record<StatKey, ReturnType<typeof setTimeout>>>>({});
  const { connected, lastEvent } = useWebSocket({ channels: ["projects", "contributions", "votes"] });

  useEffect(() => {
    let cancelled = false;
    getPlatformStats()
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      Object.values(bumpTimers.current).forEach((t) => t && clearTimeout(t));
    };
  }, []);

  function bump(key: StatKey) {
    setBumped((prev) => ({ ...prev, [key]: true }));
    const existing = bumpTimers.current[key];
    if (existing) clearTimeout(existing);
    bumpTimers.current[key] = setTimeout(() => {
      setBumped((prev) => ({ ...prev, [key]: false }));
    }, 500);
  }

  useEffect(() => {
    if (!lastEvent) return;
    setStats((prev) => {
      if (!prev) return prev;
      switch (lastEvent.type) {
        case "contribution.made":
          bump("totalRaised");
          bump("txCount");
          return { ...prev, totalRaised: prev.totalRaised + lastEvent.data.amount, txCount: prev.txCount + 1 };
        case "project.created":
          bump("activeProjects");
          bump("txCount");
          return { ...prev, activeProjects: prev.activeProjects + 1, txCount: prev.txCount + 1 };
        case "goal.reached":
        case "vote.cast":
        case "milestone.released":
          bump("txCount");
          return { ...prev, txCount: prev.txCount + 1 };
        default:
          return prev;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvent]);

  const items: { key: StatKey; label: string; value: string }[] = stats
    ? [
        { key: "totalRaised", label: "Total raised", value: formatCompactTotalRaised(stats.totalRaised) },
        { key: "activeProjects", label: "Active projects", value: formatCompactNumber(stats.activeProjects) },
        { key: "agentCount", label: "Agents registered", value: formatCompactNumber(stats.agentCount) },
        { key: "txCount", label: "Transactions", value: formatCompactNumber(stats.txCount) },
      ]
    : [];

  return (
    <div className="af-statsbar">
      <div className="af-container af-statsbar__row">
        <span className="af-statsbar__item" title={connected ? "Live" : "Reconnecting…"}>
          <span
            className={connected ? "af-pulse-dot" : "af-dot"}
            style={connected ? undefined : { color: "var(--af-text-faint)" }}
            aria-hidden="true"
          />
          {connected ? "Live" : "Connecting…"}
        </span>
        {items.length === 0 ? (
          <span className="af-statsbar__item">Awaiting first agents — stats will appear once the API is reachable.</span>
        ) : (
          items.map((item) => (
            <span key={item.key} className={`af-statsbar__item${bumped[item.key] ? " af-statsbar__item--bump" : ""}`}>
              {item.label}: <strong className="af-mono">{item.value}</strong>
            </span>
          ))
        )}
      </div>
    </div>
  );
}
