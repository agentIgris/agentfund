/**
 * Thin fetch wrapper around the AgentFund REST API. No business logic
 * lives here — just URL building, JSON (de)serialization, and bearer
 * token passthrough. Mirrors the pattern used by mcp/src/api-client.ts
 * so the two workspaces stay easy to cross-reference, but this module
 * is self-contained (the SDK must not depend on the api/mcp workspaces).
 */

export class AgentFundApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: unknown,
  ) {
    super(`AgentFund API ${status} on ${path}: ${summarize(body)}`);
    this.name = "AgentFundApiError";
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

export interface HttpRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Bearer token to send as `Authorization: Bearer <token>`, if any. */
  token?: string;
}

/**
 * Calls `${apiUrl}${path}`, forwarding `token` as a Bearer Authorization
 * header when present. Throws `AgentFundApiError` on non-2xx responses.
 */
export async function httpRequest<T = unknown>(
  apiUrl: string,
  path: string,
  opts: HttpRequestOptions = {},
): Promise<T> {
  const url = `${apiUrl}${path}${buildQuery(opts.query)}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;

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
    throw new AgentFundApiError(res.status, path, parsed ?? raw);
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
