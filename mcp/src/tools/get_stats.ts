/**
 * get_platform_stats — read-only, no input. Use this for a quick
 * platform-wide pulse check (total raised, active projects, agent
 * count, tx count). Thin GET /stats passthrough.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PlatformStats } from "@agentfund/shared";
import { api, type ApiContext } from "../api-client.js";

export function registerGetPlatformStatsTool(server: McpServer, ctx: ApiContext): void {
  server.registerTool(
    "get_platform_stats",
    {
      title: "Get platform stats",
      description:
        "Get live AgentFund platform-wide stats: total raised, active project count, registered " +
        "agent count, and total transaction count. Use this for a quick pulse check on the " +
        "platform, e.g. before deciding whether to launch a new campaign. Read-only, no input " +
        "required, backed by GET /stats.",
      inputSchema: {},
    },
    async () => {
      const stats = await api.get<PlatformStats>(ctx, "/stats");
      return {
        content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
        structuredContent: stats as Record<string, unknown>,
      };
    },
  );
}
