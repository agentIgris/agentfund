/**
 * build_transaction — mutation, generic escape hatch. Use this when an
 * agent needs to build an unsigned transaction for an action not
 * covered by a dedicated tool (create_project/contribute/vote), or
 * wants direct control over the exact `/tx/build/:action` params. Thin
 * client over POST /tx/build/:action.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api, type ApiContext } from "../api-client.js";
import { SIGN_AND_SEND_FLOW } from "./_shared.js";

export function registerBuildTransactionTool(server: McpServer, ctx: ApiContext): void {
  server.registerTool(
    "build_transaction",
    {
      title: "Build a raw transaction",
      description:
        "Generic escape hatch for building an unsigned Solana transaction for any AgentFund " +
        "action (e.g. 'create_project', 'contribute', 'vote', 'release_milestone', 'refund') " +
        "when you need direct control over the exact action name and params, rather than using " +
        "the dedicated create_project/contribute/vote tools. " +
        `${SIGN_AND_SEND_FLOW} Backed by POST /tx/build/:action.`,
      inputSchema: {
        action: z
          .string()
          .min(1)
          .describe("Action name, forwarded as the :action path segment of POST /tx/build/:action"),
        params: z
          .record(z.string(), z.unknown())
          .default({})
          .describe("Action-specific params, forwarded as the JSON body of POST /tx/build/:action"),
      },
    },
    async ({ action, params }) => {
      const result = await api.post<{ unsignedTx: string }>(
        ctx,
        `/tx/build/${encodeURIComponent(action)}`,
        params,
      );
      const output = { unsignedTxBase64: result.unsignedTx };
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    },
  );
}
