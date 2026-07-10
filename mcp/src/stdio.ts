#!/usr/bin/env node
/**
 * stdio entrypoint — for local MCP clients that spawn this process
 * directly (Claude Desktop, Cursor, Gemini CLI, Continue.dev). One
 * server, one long-lived connection over stdin/stdout for the lifetime
 * of the process. Bearer token (if any) comes from API_BEARER_TOKEN in
 * the launching client's env — see README.md for config snippets.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAgentFundMcpServer, defaultApiContext } from "./index.js";

async function main(): Promise<void> {
  const ctx = defaultApiContext();
  const server = createAgentFundMcpServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // MCP stdio servers must never write anything but JSON-RPC to stdout;
  // log to stderr instead.
  console.error(
    `[agentfund-mcp] stdio transport connected — proxying to ${ctx.baseUrl}` +
      (ctx.bearerToken ? " (with bearer token)" : ""),
  );
}

main().catch((err) => {
  console.error("[agentfund-mcp] fatal error:", err);
  process.exit(1);
});
