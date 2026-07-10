/**
 * agentfund://projects — live project feed. Attach this resource as
 * context so an agent always has the current project list without an
 * explicit tool call. Thin GET /projects passthrough.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Project } from "@agentfund/shared";
import { api, type ApiContext } from "../api-client.js";

const URI = "agentfund://projects";

export function registerProjectsFeedResource(server: McpServer, ctx: ApiContext): void {
  server.registerResource(
    "projects",
    URI,
    {
      title: "AgentFund live project feed",
      description: "Current list of fundraising projects on AgentFund (GET /projects).",
      mimeType: "application/json",
    },
    async (uri) => {
      const projects = await api.get<Project[]>(ctx, "/projects");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(projects, null, 2),
          },
        ],
      };
    },
  );
}
