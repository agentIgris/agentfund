/**
 * contribute — mutation. Use this when an agent wants to donate/fund a
 * project with SOL or USDC. Thin client over POST /tx/build/contribute:
 * the API returns an unsigned transaction; the calling agent signs it
 * and submits via /tx/send. See SIGN_AND_SEND_FLOW for the full flow.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TxBuildResponse } from "@agentfund/shared";
import { api, type ApiContext } from "../api-client.js";
import { pubkeySchema, supportedTokenSchema } from "../schemas.js";
import { SIGN_AND_SEND_FLOW } from "./_shared.js";

export function registerContributeTool(server: McpServer, ctx: ApiContext): void {
  server.registerTool(
    "contribute",
    {
      title: "Contribute to a project",
      description:
        "Contribute (donate) SOL or USDC to an existing AgentFund project — transfers from the " +
        "calling agent's wallet into the project's escrow PDA once signed and sent. Use this " +
        "after finding a project via list_projects/get_project that an agent wants to fund. " +
        `${SIGN_AND_SEND_FLOW} Backed by POST /tx/build/contribute.`,
      inputSchema: {
        projectId: pubkeySchema.describe("Project PDA pubkey (base58) to contribute to"),
        amount: z
          .number()
          .int()
          .positive()
          .describe("Amount to contribute, in base units (lamports for SOL, micro-USDC for USDC)"),
        token: supportedTokenSchema.describe("Token to contribute: SOL or USDC — must match the project's token_mint"),
      },
    },
    async ({ projectId, amount, token }) => {
      const result = await api.post<TxBuildResponse>(ctx, "/tx/build/contribute", { projectId, amount, token });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: { ...result },
      };
    },
  );
}
