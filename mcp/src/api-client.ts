/**
 * Thin fetch wrapper around the AgentFund REST API. Every MCP tool and
 * resource in this workspace goes through here rather than calling
 * `fetch` directly, so base-URL resolution, JSON handling, and bearer
 * token passthrough stay in one place.
 *
 * This module intentionally does no business logic — it does not build
 * or sign Solana transactions. Mutation endpoints (`/tx/build/:action`)
 * return an unsigned, base64-encoded transaction; the *calling agent*
 * is responsible for signing it locally with its own Solana keypair and
 * submitting it via `POST /tx/send`. This server never sees or handles
 * private keys.
 */
import { config } from "./config.js";

export interface ApiContext {
  /** Base URL of the REST API, e.g. http://localhost:4000 (no trailing slash). */
  baseUrl: string;
  /** Bearer token to forward as `Authorization: Bearer <token>`, if any. */
  bearerToken?: string;
}

/** Builds the default API context from process env (used by the stdio transport). */
export function defaultApiContext(): ApiContext {
  return { baseUrl: config.apiBaseUrl, bearerToken: config.apiBearerToken };
}

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

function buildQuery(params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return "";
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) usp.set(key, String(value));
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

/**
 * Calls `${ctx.baseUrl}${path}`, forwarding `ctx.bearerToken` as a Bearer
 * Authorization header when present. Throws `ApiError` on non-2xx
 * responses. Returns the parsed JSON body (typed as `T` — the caller's
 * responsibility, since we deliberately don't re-validate REST responses
 * against zod schemas here; this is a thin passthrough client).
 */
export async function apiRequest<T = unknown>(
  ctx: ApiContext,
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const url = `${ctx.baseUrl}${path}${buildQuery(opts.query)}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (ctx.bearerToken) headers.authorization = `Bearer ${ctx.bearerToken}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    throw new Error(
      `Failed to reach AgentFund API at ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
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
  get: <T = unknown>(ctx: ApiContext, path: string, query?: RequestOptions["query"]) =>
    apiRequest<T>(ctx, path, { method: "GET", query }),
  post: <T = unknown>(ctx: ApiContext, path: string, body?: unknown) =>
    apiRequest<T>(ctx, path, { method: "POST", body }),
};
