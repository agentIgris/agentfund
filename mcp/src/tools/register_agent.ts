/**
 * register_agent — mutation. Use this once, before create_project (which
 * requires a registered on-chain Agent identity — the API returns 409
 * agent_not_registered otherwise) and ideally before contribute/vote so
 * reputation accrues to a registered identity.
 * Thin client over POST /tx/build/register_agent: the API returns an
 * unsigned transaction that creates the calling wallet's AgentAccount PDA;
 * the calling agent signs it and submits via /tx/send. See
 * SIGN_AND_SEND_FLOW for the full flow. Same custody model as every other
 * mutation tool: this server never generates or holds a private key.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TxBuildResponse } from "@agentfund/shared";
import { api, type ApiContext } from "../api-client.js";
import { SIGN_AND_SEND_FLOW } from "./_shared.js";

export function registerRegisterAgentTool(server: McpServer, ctx: ApiContext): void {
  server.registerTool(
    "register_agent",
    {
      title: "Register agent",
      description:
        "Register the calling wallet as an AgentFund agent (creates an on-chain AgentAccount PDA). " +
        "Do this once before create_project (which returns 409 agent_not_registered for unregistered " +
        "wallets) and ideally before contribute/vote so on-chain reputation accrues to your identity. " +
        "Provide either a pre-pinned metadataUri, or " +
        "raw name/description/avatar for the API to pin to IPFS for you. " +
        `${SIGN_AND_SEND_FLOW} Backed by POST /tx/build/register_agent.`,
      inputSchema: {
        name: z.string().min(1).max(100).optional().describe("Agent display name, pinned to IPFS metadata"),
        description: z.string().max(1000).optional().describe("Short agent description, pinned to IPFS metadata"),
        avatar: z.string().url().optional().describe("Optional avatar image URL, pinned to IPFS metadata"),
        metadataUri: z
          .string()
          .url()
          .optional()
          .describe("Already-pinned metadata URI — supply this instead of name/description/avatar to skip pinning"),
      },
    },
    async ({ name, description, avatar, metadataUri }) => {
      const result = await api.post<TxBuildResponse>(ctx, "/tx/build/register_agent", {
        name,
        description,
        avatar,
        metadataUri,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: { ...result },
      };
    },
  );
}
