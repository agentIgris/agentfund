/**
 * FundRaisingAgent — spec: "Creates and manages a fundraising campaign on
 * Solana". Delegate-able, async (manifest.async === true).
 *
 * Implementation calls straight through to the REST API's project
 * creation path (spec: "FundRaisingAgent -> POST /projects + /tx/build
 * passthrough"): `POST /projects` pins the campaign's off-chain metadata
 * to IPFS, derives the deterministic project PDA for the relay wallet,
 * and returns `{ projectId, unsignedTx }` — the same unsigned-tx pattern
 * every mutation in this platform uses (see api/src/routes/projects.ts).
 * This ACP server never signs or broadcasts; the caller (or whoever
 * ultimately controls the relay wallet named by ACP_API_TOKEN) is
 * responsible for signing `unsigned_tx` and submitting it via
 * `POST {API_BASE_URL}/tx/send`.
 *
 * Unit conversion: the ACP input is human-readable USDC (spec:
 * `goal_usdc`, `milestones[].amount_usdc`) — this agent always raises in
 * USDC (not SOL) and converts to on-chain micro-USDC (x 1e6, USDC has 6
 * decimals) before calling the REST API, which itself expects base
 * units (api/src/schema/projects.ts: `goalAmount: z.number().int()`).
 */
import { api } from "../api-client.js";
import { config } from "../config.js";
import type { FundRaisingAgentInput, FundRaisingAgentOutput } from "../schemas.js";
import type { AgentDefinition } from "../types.js";
import { fundRaisingAgentInputSchema } from "../schemas.js";
import { fundRaisingAgentManifest } from "../manifests/agents.js";

/** USDC has 6 decimal places on Solana (both mainnet and devnet mints). */
const USDC_DECIMALS = 6;
const SECONDS_PER_DAY = 86_400;

function usdcToMicroUnits(amount: number): number {
  return Math.round(amount * 10 ** USDC_DECIMALS);
}

interface CreateProjectApiResponse {
  projectId: string;
  unsignedTx: string;
}

function solscanUrl(address: string): string {
  const suffix = config.solana.cluster === "mainnet-beta" ? "" : `?cluster=${config.solana.cluster}`;
  return `${config.solscanBaseUrl}/account/${address}${suffix}`;
}

async function execute(input: FundRaisingAgentInput): Promise<FundRaisingAgentOutput> {
  const deadlineUnixSeconds = Math.floor(Date.now() / 1000) + input.deadline_days * SECONDS_PER_DAY;

  const body = {
    title: input.title,
    description: input.description,
    category: input.category,
    goalAmount: usdcToMicroUnits(input.goal_usdc),
    token: "USDC" as const,
    deadline: deadlineUnixSeconds,
    milestones: input.milestones.map((m) => ({
      description: m.description,
      amount: usdcToMicroUnits(m.amount_usdc),
    })),
  };

  const result = await api.post<CreateProjectApiResponse>("/projects", body, { authenticated: true });

  return {
    project_id: result.projectId,
    project_url: `${config.frontendBaseUrl}/projects/${result.projectId}`,
    unsigned_tx: result.unsignedTx,
    solscan_url: solscanUrl(result.projectId),
  };
}

export const fundRaisingAgent: AgentDefinition<typeof fundRaisingAgentInputSchema> = {
  manifest: fundRaisingAgentManifest,
  inputSchema: fundRaisingAgentInputSchema,
  execute,
};
