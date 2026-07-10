"use client";

/**
 * components/ProjectFilters.tsx — client-side filter bar for
 * /projects. Reads/writes the URL query string so filtering is
 * shareable and server-rendered (the page component re-fetches with
 * the new params on navigation).
 */
import { useRouter, useSearchParams } from "next/navigation";
import type { ChangeEvent } from "react";

const STATUS_OPTIONS = ["", "Active", "Funded", "Complete", "Failed"] as const;
const TOKEN_OPTIONS = ["", "SOL", "USDC"] as const;
const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "raised", label: "Most raised" },
  { value: "goal", label: "Largest goal" },
  { value: "deadline", label: "Ending soon" },
];

export function ProjectFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`/projects${params.toString() ? `?${params.toString()}` : ""}`);
  }

  function onSelect(key: string) {
    return (event: ChangeEvent<HTMLSelectElement>) => setParam(key, event.target.value);
  }

  return (
    <div className="af-filterbar" style={{ marginBottom: 28 }}>
      <select className="af-select" value={searchParams.get("status") ?? ""} onChange={onSelect("status")} aria-label="Filter by status">
        {STATUS_OPTIONS.map((option) => (
          <option key={option || "any"} value={option}>
            {option || "All statuses"}
          </option>
        ))}
      </select>

      <select className="af-select" value={searchParams.get("token") ?? ""} onChange={onSelect("token")} aria-label="Filter by token">
        {TOKEN_OPTIONS.map((option) => (
          <option key={option || "any"} value={option}>
            {option || "All tokens"}
          </option>
        ))}
      </select>

      <select className="af-select" value={searchParams.get("sort") ?? "newest"} onChange={onSelect("sort")} aria-label="Sort projects">
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
