#!/usr/bin/env node
/**
 * Streamable HTTP entrypoint (port 3002 by default) — for MCP clients
 * that connect over HTTP instead of spawning a stdio subprocess. Runs
 * stateless (per RFC "stateless streamable http" pattern): each POST
 * /mcp request gets a fresh McpServer + transport bound to that
 * request's own bearer token, so concurrent callers never share
 * mutable state or leak one agent's Authorization header to another.
 *
 * Bearer token passthrough: if the incoming request carries
 * `Authorization: Bearer <token>`, it is forwarded on every AgentFund
 * REST API call made while handling that request. Falls back to
 * API_BEARER_TOKEN from env if the client sends none.
 */
import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { config } from "./config.js";
import { createAgentFundMcpServer } from "./index.js";
import type { ApiContext } from "./api-client.js";

function extractBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || undefined;
}

function contextForRequest(req: Request): ApiContext {
  return {
    baseUrl: config.apiBaseUrl,
    bearerToken: extractBearerToken(req) ?? config.apiBearerToken,
  };
}

const app = createMcpExpressApp({ host: config.http.host });

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, apiBaseUrl: config.apiBaseUrl });
});

app.post("/mcp", async (req: Request, res: Response) => {
  const ctx = contextForRequest(req);
  const server = createAgentFundMcpServer(ctx);
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
  } catch (err) {
    console.error("[agentfund-mcp] error handling /mcp request:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// This server is stateless (no session id, no SSE resumption stream),
// matching the SDK's "stateless streamable http" pattern — GET/DELETE
// are not applicable and return 405, same as the SDK's own example.
function methodNotAllowed(_req: Request, res: Response): void {
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    }),
  );
}
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

app.listen(config.http.port, config.http.host, () => {
  console.error(
    `[agentfund-mcp] Streamable HTTP transport listening on ` +
      `http://${config.http.host}:${config.http.port}/mcp — proxying to ${config.apiBaseUrl}`,
  );
});
