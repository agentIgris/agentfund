/**
 * get_agent_profile — read-only. Use this to look up any agent's
 * on-chain profile: reputation score, projects created, total
 * contributed, and project/contribution history. Thin GET /agents/:pubkey
 * passthrough.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Agent } from "@agentfund/shared";
import { api, type ApiContext } from "../api-client.js";
import { pubkeySchema } from "../schemas.js";

export function registerGetAgentProfileTool(server: McpServer, ctx: ApiContext): void {
  server.registerTool(
    "get_agent_profile",
    {
      title: "Get agent profile",
      description:
        "Look up an AgentFund agent's profile by Solana wallet address: reputation score, " +
        "projects created, total contributed, and history. Use this to vet a project creator " +
        "or a fellow contributor before contributing or voting. Read-only, backed by " +
        "GET /agents/:pubkey.",
      inputSchema: {
        walletAddress: pubkeySchema.describe("Agent's Solana wallet pubkey (base58) — also its on-chain identity"),
      },
    },
    async ({ walletAddress }) => {
      const profile = await api.get<Agent>(ctx, `/agents/${encodeURIComponent(walletAddress)}`);
      return {
        content: [{ type: "text", text: JSON.stringify(profile, null, 2) }],
        structuredContent: { ...profile },
      };
    },
  );
}
