/**
 * Config module — reads all env vars once at startup, mirroring the
 * pattern used in api/src/config.ts and mcp/src/config.ts. Nothing else
 * in this workspace touches `process.env` directly.
 *
 * Note on API_BASE_URL default: the @agentfund/api workspace's own
 * config (api/src/config.ts) defaults PORT to 4000, and the repo-root
 * .env.example sets API_BASE_URL=http://localhost:4000 — so that's the
 * fallback used here too.
 *
 * Note on PORT: the task spec pins this server to port 3003
 * (api=4000, mcp=3002, acp=3003).
 */
import "dotenv/config";
import { resolveSolanaCluster, type SolanaCluster } from "@agentfund/shared";

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : fallback;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const apiBaseUrl = str("API_BASE_URL", "http://localhost:4000").replace(/\/+$/, "");

/** Derives the API's WebSocket URL (ws(s)://.../ws) from API_BASE_URL, unless overridden. */
function deriveWsUrl(base: string): string {
  const explicit = str("API_WS_URL", "");
  if (explicit) return explicit;
  const wsScheme = base.startsWith("https://") ? "wss://" : "ws://";
  const host = base.replace(/^https?:\/\//, "");
  return `${wsScheme}${host}/ws`;
}

const cluster: SolanaCluster = resolveSolanaCluster(process.env);

export const config = {
  nodeEnv: str("NODE_ENV", "development"),
  isProduction: str("NODE_ENV", "development") === "production",
  host: str("ACP_HOST", "0.0.0.0"),
  port: num("ACP_PORT", 3003),
  logLevel: str("LOG_LEVEL", "info"),
  corsOrigin: str("CORS_ORIGIN", "*"),

  solana: {
    cluster,
  },

  /** Base URL of the AgentFund REST API this ACP server proxies to. */
  apiBaseUrl,
  /** WebSocket URL for the same API (used by MonitorAgent). */
  apiWsUrl: deriveWsUrl(apiBaseUrl),

  /**
   * Static bearer token this ACP server presents to the REST API as
   * `Authorization: Bearer <token>` when an agent action requires an
   * authenticated wallet (FundRaisingAgent's create_project,
   * DonationAgent's contribute). AgentFund's ACP server acts as a single
   * *relay agent* with its own registered Solana wallet — external ACP
   * callers never hand this service their own private key or JWT; they
   * delegate the task and this server executes it as that relay
   * identity, then hands back an unsigned transaction for them to
   * inspect/countersign in their own flow if desired.
   *
   * Obtain this token via the platform's normal Solana-keypair auth flow
   * (GET /auth/challenge + POST /auth/verify) for the relay wallet, then
   * set it here. Left empty in dev — requests needing auth will fail
   * with a clear "acp_relay_unauthenticated" error until configured.
   */
  apiBearerToken: str("ACP_API_TOKEN", "") || undefined,

  /** Used to build FundRaisingAgent's project_url. */
  frontendBaseUrl: str("FRONTEND_BASE_URL", "https://predictbgmi.fun").replace(/\/+$/, ""),

  /** Used to build *_url fields that point at a block explorer. */
  solscanBaseUrl: str("SOLSCAN_BASE_URL", "https://solscan.io"),

  runs: {
    /** How long a *terminal* (complete/failed/cancelled) run is kept in the in-memory store before GC. */
    ttlMs: num("ACP_RUN_TTL_MS", 30 * 60 * 1000),
    /** How often the TTL sweep runs. */
    sweepIntervalMs: num("ACP_RUN_SWEEP_INTERVAL_MS", 60 * 1000),
    /** SSE heartbeat comment interval, to keep the stream alive through proxies. */
    sseHeartbeatMs: num("ACP_SSE_HEARTBEAT_MS", 25 * 1000),
  },

  server: {
    name: "agentfund-acp",
    version: "1.0.0",
  },
};

export type Config = typeof config;
