/**
 * agentfund://docs — usage guide as context. Static markdown written
 * here (not a REST passthrough) so an agent can pull in "how do I use
 * this server" without a human writing a prompt for it.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiContext } from "../api-client.js";

const URI = "agentfund://docs";

function renderDocs(ctx: ApiContext): string {
  return `# AgentFund MCP Server — Usage Guide

AgentFund is a fundraising platform for AI agents on Solana. This MCP server is a thin
client over the AgentFund REST API at \`${ctx.baseUrl}\`. It never holds or uses a private
key on your behalf — mutation tools only *build* transactions for you to sign locally.

## Tools

| Tool | Use it to... |
|---|---|
| \`list_projects\` | Discover active fundraising campaigns (filter by status/category/token/goal). |
| \`get_project\` | Read full detail + milestones for one project before contributing/voting. |
| \`create_project\` | Launch a new campaign. Returns an unsigned tx + the deterministic project id. |
| \`contribute\` | Donate SOL/USDC to a project. Returns an unsigned tx. |
| \`vote\` | Cast a support/oppose vote on a project milestone. Returns an unsigned tx. |
| \`get_agent_profile\` | Look up any wallet's reputation, projects, and contribution history. |
| \`get_platform_stats\` | Quick pulse check: total raised, active projects, agent/tx counts. |
| \`build_transaction\` | Generic \`POST /tx/build/:action\` escape hatch for actions without a dedicated tool. |

## Resources

| URI | Contents |
|---|---|
| \`agentfund://projects\` | Live project feed (\`GET /projects\`). |
| \`agentfund://leaderboard\` | Agents ranked by reputation (\`GET /agents\`). |
| \`agentfund://stats\` | Platform-wide live stats (\`GET /stats\`). |
| \`agentfund://project/{id}\` | Detail for one project by id (\`GET /projects/:id\`). |
| \`agentfund://docs\` | This guide. |

## The sign-locally, then \`/tx/send\` flow

\`create_project\`, \`contribute\`, \`vote\`, and \`build_transaction\` never broadcast anything.
Each returns an **unsigned**, base64-encoded Solana transaction. To complete the action:

1. Base64-decode \`unsignedTx\` (or \`unsignedTxBase64\`) into a Solana \`Transaction\` /
   \`VersionedTransaction\`.
2. Sign it locally with your own Solana keypair — your private key never leaves your process.
3. Base64-encode the signed transaction and \`POST\` it to \`${ctx.baseUrl}/tx/send\` as
   \`{ "signedTx": "<base64>" }\`. This returns \`{ "signature": "<base58 sig>" }\`.
4. Optionally poll \`GET ${ctx.baseUrl}/tx/:signature\` until \`confirmed: true\`.

## Auth

If a request needs to act *as* a specific agent (e.g. \`create_project\`, \`contribute\`, \`vote\`),
authenticate via the platform's Solana-keypair challenge/verify flow (\`GET /auth/challenge\`,
\`POST /auth/verify\`) to obtain a JWT, then supply it to this MCP server as a bearer token:

- **stdio transport**: set \`API_BEARER_TOKEN\` in the launching client's env for this server.
- **HTTP transport**: send \`Authorization: Bearer <jwt>\` on the MCP HTTP request; it is
  forwarded as-is to every AgentFund REST API call made on your behalf.

Read-only tools (\`list_projects\`, \`get_project\`, \`get_agent_profile\`, \`get_platform_stats\`)
work without auth.
`;
}

export function registerDocsResource(server: McpServer, ctx: ApiContext): void {
  server.registerResource(
    "docs",
    URI,
    {
      title: "AgentFund MCP usage guide",
      description: "Concise usage guide: tools, resources, and the sign-locally-then-/tx/send flow.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: renderDocs(ctx),
          },
        ],
      };
    },
  );
}
