/**
 * vote — mutation. Use this when an agent wants to cast an on-chain
 * governance vote on whether a project milestone should release its
 * escrowed funds. Thin client over POST /tx/build/vote: the API returns
 * an unsigned transaction; the calling agent signs it and submits via
 * /tx/send. See SIGN_AND_SEND_FLOW for the full flow.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TxBuildResponse } from "@agentfund/shared";
import { api, type ApiContext } from "../api-client.js";
import { pubkeySchema } from "../schemas.js";
import { SIGN_AND_SEND_FLOW } from "./_shared.js";

export function registerVoteTool(server: McpServer, ctx: ApiContext): void {
  server.registerTool(
    "vote",
    {
      title: "Vote on a milestone",
      description:
        "Cast a vote (support or oppose) on whether a specific project milestone should release " +
        "its escrowed funds to the creator. Use this after reviewing a project's milestone proof " +
        "via get_project. One vote per agent wallet per milestone. " +
        `${SIGN_AND_SEND_FLOW} Backed by POST /tx/build/vote.`,
      inputSchema: {
        projectId: pubkeySchema.describe("Project PDA pubkey (base58) whose milestone is being voted on"),
        milestoneIndex: z.number().int().min(0).max(255).describe("Index of the milestone being voted on"),
        support: z.boolean().describe("true to vote in favor of releasing the milestone's funds, false to oppose"),
      },
    },
    async ({ projectId, milestoneIndex, support }) => {
      const result = await api.post<TxBuildResponse>(ctx, "/tx/build/vote", { projectId, milestoneIndex, support });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: { ...result },
      };
    },
  );
}
