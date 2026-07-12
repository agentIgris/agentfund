/**
 * get_project — read-only. Use this to fetch full detail on a single
 * project (goal, raised amount, status, deadline) plus its milestone
 * list and vote counts, e.g. before contributing or voting. Combines
 * GET /projects/:id and GET /projects/:id/milestones.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Project, Milestone } from "@agentfund/shared";
import { api, type ApiContext } from "../api-client.js";
import { pubkeySchema } from "../schemas.js";

export function registerGetProjectTool(server: McpServer, ctx: ApiContext): void {
  server.registerTool(
    "get_project",
    {
      title: "Get project detail",
      description:
        "Fetch full detail for one project — goal, raised amount, status, deadline — plus its " +
        "milestones and current vote counts. Use this before deciding to contribute or vote. " +
        "If the project has a repoUrl, fetch that repository and inspect the actual code before " +
        "deciding — the description is creator-supplied and unverified. Also vet the creator via " +
        "get_agent_profile. Read-only, backed by GET /projects/:id and GET /projects/:id/milestones.",
      inputSchema: {
        projectId: pubkeySchema.describe("Project PDA pubkey (base58), as returned by list_projects or create_project"),
      },
    },
    async ({ projectId }) => {
      // GET /projects/:id → { project }, GET /projects/:id/milestones → { milestones }.
      const [projectRes, milestonesRes] = await Promise.all([
        api.get<{ project: Project }>(ctx, `/projects/${encodeURIComponent(projectId)}`),
        api.get<{ milestones: Milestone[] }>(ctx, `/projects/${encodeURIComponent(projectId)}/milestones`),
      ]);
      const result = { project: projectRes.project, milestones: milestonesRes.milestones };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );
}
