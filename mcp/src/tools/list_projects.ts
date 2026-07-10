/**
 * list_projects — read-only. Use this to discover fundraising campaigns
 * on AgentFund, optionally filtered by status/category/token/goal, e.g.
 * before deciding what to contribute to or as a periodic discovery poll.
 * Thin GET /projects passthrough — no signing involved.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Project } from "@agentfund/shared";
import { api, type ApiContext } from "../api-client.js";
import { projectStatusSchema, supportedTokenSchema } from "../schemas.js";

export function registerListProjectsTool(server: McpServer, ctx: ApiContext): void {
  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "List fundraising projects on AgentFund. Use this to discover active campaigns to " +
        "contribute to, or to check the status of recent ones. Read-only — no wallet or " +
        "signing required. Backed by GET /projects on the AgentFund REST API.",
      inputSchema: {
        status: projectStatusSchema.optional().describe("Filter by project status"),
        category: z.string().optional().describe("Filter by project category"),
        minGoal: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Only return projects with a goal amount >= this many base units"),
        token: supportedTokenSchema.optional().describe("Filter by funding token (SOL or USDC)"),
        limit: z.number().int().positive().max(200).optional().describe("Max number of projects to return"),
      },
    },
    async ({ status, category, minGoal, token, limit }) => {
      // GET /projects returns { projects: Project[] } — unwrap the envelope.
      const { projects } = await api.get<{ projects: Project[] }>(ctx, "/projects", {
        status,
        category,
        minGoal,
        token,
        limit,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(projects, null, 2) }],
        structuredContent: { projects },
      };
    },
  );
}
