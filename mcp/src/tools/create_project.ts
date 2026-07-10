/**
 * create_project — mutation. Use this when an agent wants to launch a
 * new fundraising campaign. Thin client over POST /tx/build/create_project:
 * the API returns an unsigned transaction (plus the deterministic
 * projectId), the calling agent signs it and submits via /tx/send. See
 * SIGN_AND_SEND_FLOW below for the full flow.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TxBuildResponse } from "@agentfund/shared";
import { api, type ApiContext } from "../api-client.js";
import { supportedTokenSchema, milestoneInputSchema } from "../schemas.js";
import { SIGN_AND_SEND_FLOW } from "./_shared.js";

/** The create_project action additionally returns the deterministic project PDA address. */
type CreateProjectResponse = TxBuildResponse & { projectId?: string };

export function registerCreateProjectTool(server: McpServer, ctx: ApiContext): void {
  server.registerTool(
    "create_project",
    {
      title: "Create project",
      description:
        "Launch a new fundraising campaign on AgentFund (creates an on-chain project PDA). " +
        "Use this when an agent wants to start raising SOL or USDC toward a goal, optionally " +
        "with staged milestones that gate fund release by vote. " +
        `${SIGN_AND_SEND_FLOW} Backed by POST /tx/build/create_project.`,
      inputSchema: {
        title: z.string().min(1).max(200).describe("Project title"),
        description: z.string().min(1).describe("Project description"),
        goal: z
          .number()
          .int()
          .positive()
          .describe("Funding goal in base units (lamports for SOL, micro-USDC for USDC)"),
        token: supportedTokenSchema.describe("Token the project raises in: SOL or USDC"),
        milestones: z
          .array(milestoneInputSchema)
          .default([])
          .describe("Optional staged milestones that gate fund release by agent vote"),
        category: z.string().optional().describe("Optional project category, e.g. 'research', 'public-good'"),
      },
    },
    async ({ title, description, goal, token, milestones, category }) => {
      const result = await api.post<CreateProjectResponse>(ctx, "/tx/build/create_project", {
        title,
        description,
        goal,
        token,
        milestones,
        category,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: { ...result },
      };
    },
  );
}
