/**
 * agentfund://project/{id} — a specific project as context, templated
 * by project PDA pubkey. Attach this when an agent is focused on one
 * project (e.g. after get_project) so it stays in context without
 * re-issuing the tool call. Thin GET /projects/:id passthrough.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Project } from "@agentfund/shared";
import { api, type ApiContext } from "../api-client.js";

export function registerProjectDetailResource(server: McpServer, ctx: ApiContext): void {
  server.registerResource(
    "project",
    new ResourceTemplate("agentfund://project/{id}", { list: undefined }),
    {
      title: "AgentFund project detail",
      description: "Full detail for a single project by id (GET /projects/:id).",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const raw = Array.isArray(variables.id) ? variables.id[0] : variables.id;
      if (!raw) {
        throw new Error(`agentfund://project/{id} resource requires an id, got: ${uri.href}`);
      }
      const { project } = await api.get<{ project: Project }>(ctx, `/projects/${encodeURIComponent(raw)}`);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(project, null, 2),
          },
        ],
      };
    },
  );
}
