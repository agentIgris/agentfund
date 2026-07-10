/**
 * agentfund://stats — platform-wide live stats. Attach as context for a
 * quick pulse check without an explicit tool call. Thin GET /stats
 * passthrough.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PlatformStats } from "@agentfund/shared";
import { api, type ApiContext } from "../api-client.js";

const URI = "agentfund://stats";

export function registerPlatformStatsResource(server: McpServer, ctx: ApiContext): void {
  server.registerResource(
    "stats",
    URI,
    {
      title: "AgentFund platform stats",
      description: "Live platform-wide stats: total raised, active projects, agent count, tx count (GET /stats).",
      mimeType: "application/json",
    },
    async (uri) => {
      const stats = await api.get<PlatformStats>(ctx, "/stats");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(stats, null, 2),
          },
        ],
      };
    },
  );
}
