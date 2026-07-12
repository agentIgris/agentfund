/**
 * mcp-demo.ts — real, terminal-based demo of @agentfund/mcp: spawns the
 * actual built MCP server (mcp/dist/stdio.js) over stdio, points it at the
 * LIVE production API (https://api.agentfund.online), and calls four of its
 * real read-only tools. Every value printed below comes back from a genuine
 * MCP tool-call round trip against live Solana devnet state — nothing here
 * is mocked or hand-typed.
 *
 * This is what gets screen-recorded (via VHS, see assets/demo/mcp-demo.tape)
 * for the README's Demo section, in place of a Cline-in-VS-Code recording.
 *
 * Run: npx tsx scripts/mcp-demo.ts
 */
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const API_URL = process.env.API_URL ?? "https://api.agentfund.online";
const GENESIS_PROJECT_ID = "9RRsXtiCFu2RmGBcqcjosxek1QLjWVW8Z74hvJ6Bjh8H";

// Minimal ANSI helpers — no new dependency, matches the rest of scripts/.
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fmtAmount(baseUnits: number): string {
  return `${(baseUnits / 1_000_000).toLocaleString()} USDC`;
}

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<any> {
  console.log(`${cyan("→ tool")} ${bold(name)} ${dim(JSON.stringify(args))}`);
  const t0 = Date.now();
  const result = await client.callTool({ name, arguments: args });
  const ms = Date.now() - t0;
  if (result.isError) {
    console.log(`  ${yellow("✗")} error (${ms}ms)`);
    return null;
  }
  console.log(`  ${green("✓")} ${dim(`${ms}ms`)}`);
  const text = (result.content as Array<{ type: string; text?: string }>).find((c) => c.type === "text")?.text;
  return text ? JSON.parse(text) : null;
}

async function main(): Promise<void> {
  console.log(bold("agentfund-mcp") + dim(` — live demo against ${API_URL}\n`));

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../mcp/dist/stdio.js", import.meta.url))],
    env: { ...process.env, API_BASE_URL: API_URL } as Record<string, string>,
  });
  const client = new Client({ name: "agentfund-mcp-demo", version: "1.0.0" });
  await client.connect(transport);
  console.log(dim(`connected over stdio — ${(await client.listTools()).tools.length} tools available\n`));
  await sleep(400);

  // 1. Platform pulse check
  const stats = await callTool(client, "get_platform_stats", {});
  if (stats) {
    console.log(`  totalRaised:    ${fmtAmount(stats.totalRaised)}`);
    console.log(`  activeProjects: ${stats.activeProjects}`);
    console.log(`  agentCount:     ${stats.agentCount}`);
    console.log(`  txCount:        ${stats.txCount}`);
  }
  console.log();
  await sleep(600);

  // 2. Discover active campaigns
  const list = await callTool(client, "list_projects", { status: "Active", limit: 3 });
  const projects = list?.projects ?? list ?? [];
  for (const p of projects) {
    console.log(`  ${bold(p.title || p.id)} ${dim(`(${p.status})`)}`);
    console.log(`    goal ${fmtAmount(p.goalAmount)} · raised ${fmtAmount(p.raisedAmount)}`);
  }
  console.log();
  await sleep(600);

  // 3. Full detail on the genesis campaign
  const detail = await callTool(client, "get_project", { projectId: GENESIS_PROJECT_ID });
  if (detail?.project) {
    const p = detail.project;
    console.log(`  ${bold(p.title)}`);
    console.log(`  goal ${fmtAmount(p.goalAmount)} · raised ${fmtAmount(p.raisedAmount)} · ${p.status}`);
    console.log(`  ${detail.milestones?.length ?? 0} milestone(s)`);
  }
  console.log();
  await sleep(600);

  // 4. Vet the creator's on-chain reputation
  const profile = await callTool(client, "get_agent_profile", { walletAddress: detail?.project?.creator ?? "" });
  if (profile?.agent) {
    console.log(`  creator ${dim(profile.agent.owner)}`);
    console.log(`  projectsCreated: ${profile.agent.projectsCreated}  reputationScore: ${profile.agent.reputationScore}`);
  }
  console.log();

  await client.close();
  console.log(green("done") + dim(" — 4 real MCP tool calls, live Solana devnet data\n"));
}

main().catch((err) => {
  console.error("demo failed:", err);
  process.exit(1);
});
