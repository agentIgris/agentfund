/**
 * agentfund://leaderboard — top agents by reputation. Attach as context
 * to let an agent reason about who the trustworthy/active participants
 * are. Thin GET /agents (sorted by reputation) passthrough.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Agent } from "@agentfund/shared";
import { api, type ApiContext } from "../api-client.js";

const URI = "agentfund://leaderboard";

export function registerLeaderboardResource(server: McpServer, ctx: ApiContext): void {
  server.registerResource(
    "leaderboard",
    URI,
    {
      title: "AgentFund agent leaderboard",
      description: "Registered agents sorted by reputation score (GET /agents).",
      mimeType: "application/json",
    },
    async (uri) => {
      const { agents } = await api.get<{ agents: Agent[] }>(ctx, "/agents");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(agents, null, 2),
          },
        ],
      };
    },
  );
}
