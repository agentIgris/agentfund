/**
 * Thin fetch wrapper around the AgentFund REST API — mirrors
 * mcp/src/api-client.ts's pattern. Every ACP agent implementation in
 * this workspace goes through here rather than calling `fetch`
 * directly, so base-URL resolution, JSON handling, and bearer-token
 * passthrough stay in one place.
 *
 * This module does no business logic — it does not build or sign
 * Solana transactions itself. `/tx/build/:action` (and the project
 * convenience routes that wrap it) return an unsigned, base64-encoded
 * transaction; this server never holds a private key for the relay
 * wallet's on-chain signature — only a bearer JWT proving the relay
 * wallet's identity to the REST API, which is enough to have the API
 * build (but not sign) transactions with that wallet as fee payer.
 */
import { config } from "./config.js";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: unknown,
  ) {
    super(`AgentFund API ${status} on ${path}: ${summarize(body)}`);
    this.name = "ApiError";
  }
}

function summarize(body: unknown): string {
  if (typeof body === "string") return body.slice(0, 500);
  try {
    return JSON.stringify(body).slice(0, 500);
  } catch {
    return String(body);
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Forward the configured relay bearer token (config.apiBearerToken) on this call. */
  authenticated?: boolean;
}

/**
 * Calls `${config.apiBaseUrl}${path}`. Throws `ApiError` on non-2xx
 * responses. Returns the parsed JSON body (typed as `T` — the caller's
 * responsibility; this is a deliberately thin passthrough client that
 * does not re-validate REST responses against zod schemas).
 */
export async function apiRequest<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = `${config.apiBaseUrl}${path}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.authenticated) {
    if (!config.apiBearerToken) {
      throw new ApiError(401, path, {
        error: "acp_relay_unauthenticated",
        message:
          "This action requires ACP_API_TOKEN to be set (a bearer JWT for AgentFund's relay wallet, obtained via GET /auth/challenge + POST /auth/verify against the REST API).",
      });
    }
    headers.authorization = `Bearer ${config.apiBearerToken}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    throw new Error(`Failed to reach AgentFund API at ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const raw = await res.text();
  const parsed: unknown = raw ? safeJsonParse(raw) : undefined;

  if (!res.ok) {
    throw new ApiError(res.status, path, parsed ?? raw);
  }
  return parsed as T;
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export const api = {
  get: <T = unknown>(path: string, opts: Omit<RequestOptions, "method" | "body"> = {}) =>
    apiRequest<T>(path, { ...opts, method: "GET" }),
  post: <T = unknown>(path: string, body?: unknown, opts: Omit<RequestOptions, "method" | "body"> = {}) =>
    apiRequest<T>(path, { ...opts, method: "POST", body }),
};
