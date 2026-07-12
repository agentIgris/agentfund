/**
 * Core MCP server factory — shared by both transports (src/stdio.ts and
 * src/http.ts). Registers all 9 tools and 5 resources from the spec's
 * "MCP Server" section against a given ApiContext (base URL + optional
 * bearer token), so the two entrypoints differ only in how they obtain
 * that context and hand the resulting server off to a transport.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "./config.js";
import type { ApiContext } from "./api-client.js";

import { registerListProjectsTool } from "./tools/list_projects.js";
import { registerGetProjectTool } from "./tools/get_project.js";
import { registerRegisterAgentTool } from "./tools/register_agent.js";
import { registerCreateProjectTool } from "./tools/create_project.js";
import { registerContributeTool } from "./tools/contribute.js";
import { registerVoteTool } from "./tools/vote.js";
import { registerGetAgentProfileTool } from "./tools/get_agent.js";
import { registerGetPlatformStatsTool } from "./tools/get_stats.js";
import { registerBuildTransactionTool } from "./tools/build_transaction.js";

import { registerProjectsFeedResource } from "./resources/projects_feed.js";
import { registerLeaderboardResource } from "./resources/leaderboard.js";
import { registerPlatformStatsResource } from "./resources/platform_stats.js";
import { registerProjectDetailResource } from "./resources/project_detail.js";
import { registerDocsResource } from "./resources/docs.js";

export function createAgentFundMcpServer(ctx: ApiContext): McpServer {
  const server = new McpServer({
    name: config.server.name,
    version: config.server.version,
  });

  // Tools
  registerListProjectsTool(server, ctx);
  registerGetProjectTool(server, ctx);
  registerRegisterAgentTool(server, ctx);
  registerCreateProjectTool(server, ctx);
  registerContributeTool(server, ctx);
  registerVoteTool(server, ctx);
  registerGetAgentProfileTool(server, ctx);
  registerGetPlatformStatsTool(server, ctx);
  registerBuildTransactionTool(server, ctx);

  // Resources
  registerProjectsFeedResource(server, ctx);
  registerLeaderboardResource(server, ctx);
  registerPlatformStatsResource(server, ctx);
  registerProjectDetailResource(server, ctx);
  registerDocsResource(server, ctx);

  return server;
}

export type { ApiContext } from "./api-client.js";
export { defaultApiContext } from "./api-client.js";
