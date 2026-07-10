/**
 * Config module — reads all env vars once at startup, mirroring the
 * pattern used in api/src/config.ts. Nothing else in this workspace
 * touches `process.env` directly.
 *
 * Note on API_BASE_URL default: the @agentfund/api workspace's own
 * config (api/src/config.ts) defaults PORT to 4000, and the repo-root
 * .env.example sets API_BASE_URL=http://localhost:4000 — so that's the
 * fallback used here too, to stay in agreement with the rest of the
 * running system rather than guessing a different port.
 */
import "dotenv/config";

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

export const config = {
  /** Base URL of the AgentFund REST API this MCP server proxies to. */
  apiBaseUrl: str("API_BASE_URL", "http://localhost:4000").replace(/\/+$/, ""),

  /**
   * Optional static bearer token used by the stdio transport (set this
   * in the launching client's env, e.g. Claude Desktop's mcpServers.env)
   * so authenticated calls (create_project, contribute, vote) carry an
   * `Authorization: Bearer <token>` header through to the REST API.
   * The HTTP transport instead reads the bearer token per-request from
   * the incoming Authorization header (see src/http.ts) and this value
   * is only used there as a fallback.
   */
  apiBearerToken: str("API_BEARER_TOKEN", "") || undefined,

  http: {
    host: str("MCP_HTTP_HOST", "0.0.0.0"),
    port: num("MCP_HTTP_PORT", 3002),
  },

  server: {
    name: "agentfund-mcp",
    version: "0.1.0",
  },
};

export type Config = typeof config;
