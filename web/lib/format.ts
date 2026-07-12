/**
 * lib/format.ts — presentation helpers shared by every page/component.
 * Only imports plain constants (no process.env reads) from
 * @agentfund/shared so this stays safe to use in client components.
 */
import { NATIVE_SOL_MINT, USDC_MINT, type SupportedToken, type Project } from "@agentfund/shared";

const LAMPORTS_PER_SOL = 1_000_000_000;
const USDC_DECIMALS = 1_000_000;

/** Pluralizes a noun for a count, e.g. `pluralize(1, "project")` -> "project", `pluralize(0, "project")` -> "projects". */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

/** Resolves a token mint address to its display symbol. Defaults to USDC for unknown mints. */
export function tokenSymbolForMint(mint: string): SupportedToken {
  if (mint === NATIVE_SOL_MINT) return "SOL";
  if (mint === USDC_MINT["mainnet-beta"] || mint === USDC_MINT.devnet) return "USDC";
  return "USDC";
}

/** Converts base units (lamports or micro-USDC) to a human-readable decimal amount. */
export function baseUnitsToDecimal(amount: number, symbol: SupportedToken): number {
  const divisor = symbol === "SOL" ? LAMPORTS_PER_SOL : USDC_DECIMALS;
  return amount / divisor;
}

/** Formats a base-unit amount for display, e.g. `1,250.5 USDC`. */
export function formatAmount(amount: number, mint: string): string {
  const symbol = tokenSymbolForMint(mint);
  const decimal = baseUnitsToDecimal(amount, symbol);
  const formatted = decimal.toLocaleString("en-US", {
    maximumFractionDigits: symbol === "SOL" ? 4 : 2,
    minimumFractionDigits: 0,
  });
  return `${formatted} ${symbol}`;
}

/** Truncates a base58 pubkey/signature to `abcd…wxyz` form. */
export function truncateAddress(address: string, lead = 4, trail = 4): string {
  if (address.length <= lead + trail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-trail)}`;
}

/**
 * Relative time string like "3m ago" / "in 2d".
 * Accepts either a unix-seconds number or an ISO timestamp string, since some
 * API responses serialize Prisma DateTime fields as ISO strings while others
 * (on-chain derived fields like a project deadline) are plain unix seconds.
 */
export function relativeTime(timestamp: number | string): string {
  const unixSeconds =
    typeof timestamp === "string" ? new Date(timestamp).getTime() / 1000 : timestamp;
  const deltaMs = unixSeconds * 1000 - Date.now();
  const deltaSec = Math.round(deltaMs / 1000);
  const abs = Math.abs(deltaSec);
  const future = deltaSec > 0;

  const units: [number, string][] = [
    [60, "s"],
    [60, "m"],
    [24, "h"],
    [7, "d"],
    [4.345, "w"],
    [12, "mo"],
    [Number.POSITIVE_INFINITY, "y"],
  ];

  let value = abs;
  let label = "s";
  for (const [factor, unit] of units) {
    if (value < factor) {
      label = unit;
      break;
    }
    value = Math.floor(value / factor);
    label = unit;
  }

  const rounded = Math.max(0, Math.floor(value));
  if (rounded === 0) return "just now";
  return future ? `in ${rounded}${label}` : `${rounded}${label} ago`;
}

/** ISO timestamp (from Prisma createdAt/updatedAt) to a short relative label. */
export function relativeTimeIso(iso: string): string {
  return relativeTime(Math.floor(new Date(iso).getTime() / 1000));
}

/** Clamp a raised/goal ratio to [0, 100] for progress bars. */
export function fundingPercent(raised: number, goal: number): number {
  if (!goal || goal <= 0) return 0;
  return Math.min(100, Math.max(0, (raised / goal) * 100));
}

/** Deterministic hue from a pubkey string, used for generated avatar gradients. */
export function hueFromAddress(address: string): number {
  let hash = 0;
  for (let i = 0; i < address.length; i += 1) {
    hash = (hash * 31 + address.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

export function statusLabel(status: string): string {
  return status;
}

const STATUS_PILL_CLASS: Record<Project["status"], string> = {
  Active: "af-pill--active",
  Funded: "af-pill--funded",
  Failed: "af-pill--failed",
  Complete: "af-pill--complete",
};

/** CSS class for a project's status pill, shared by ProjectCard and the project detail page. */
export function statusPillClass(status: Project["status"]): string {
  return STATUS_PILL_CLASS[status] ?? "";
}

export function formatCompactNumber(n: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/**
 * Formats the platform-wide `totalRaised` stat (base units, summed across
 * every project's token by the API) as a compact USDC amount. The backend
 * aggregate doesn't track which mint each project uses, so this assumes
 * USDC decimals — the only token any live project has used so far. If a
 * SOL-denominated project shows up this will need a token-aware total from
 * the API instead.
 */
export function formatCompactTotalRaised(totalRaisedBaseUnits: number): string {
  return `${formatCompactNumber(baseUnitsToDecimal(totalRaisedBaseUnits, "USDC"))} USDC`;
}
