/**
 * DonationAgent — spec: "Contributes SOL or USDC to a project".
 * Delegate-able, sync (manifest.async === false).
 *
 * Implementation: "DonationAgent -> /tx/build contribute passthrough".
 * Converts the human-readable `amount` (SOL or USDC, per `token`) to
 * base units (lamports / micro-USDC) and calls
 * `POST /tx/build/contribute` (api/src/routes/tx.ts), which returns an
 * unsigned transaction with the relay wallet as fee payer — this server
 * never signs or broadcasts it.
 *
 * Before building the transaction, this agent fetches the project
 * (GET /projects/:id) to confirm `token` actually matches the project's
 * on-chain `tokenMint` — `/tx/build/contribute` itself derives the mint
 * from the project record and has no `token` parameter to cross-check
 * against, so this agent is the only place that catches a caller
 * donating in the wrong currency before a transaction is even built.
 */
import { NATIVE_SOL_MINT, resolveUsdcMint } from "@agentfund/shared";
import { api, ApiError } from "../api-client.js";
import { config } from "../config.js";
import type { DonationAgentInput, DonationAgentOutput } from "../schemas.js";
import type { AgentDefinition } from "../types.js";
import { donationAgentInputSchema } from "../schemas.js";
import { donationAgentManifest } from "../manifests/agents.js";

const LAMPORTS_PER_SOL = 1e9;
const USDC_MICRO_UNITS_PER_UNIT = 1e6;

interface ProjectApiShape {
  id: string;
  tokenMint: string;
}

interface TxBuildContributeResponse {
  unsignedTx: string;
}

function toBaseUnits(amount: number, token: DonationAgentInput["token"]): number {
  return Math.round(amount * (token === "SOL" ? LAMPORTS_PER_SOL : USDC_MICRO_UNITS_PER_UNIT));
}

async function execute(input: DonationAgentInput): Promise<DonationAgentOutput> {
  let project: ProjectApiShape;
  try {
    const res = await api.get<{ project: ProjectApiShape }>(`/projects/${input.project_id}`);
    project = res.project;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      throw new Error(`Project ${input.project_id} not found`);
    }
    throw err;
  }

  const expectedMint = input.token === "SOL" ? NATIVE_SOL_MINT : resolveUsdcMint({ SOLANA_CLUSTER: config.solana.cluster });
  if (project.tokenMint !== expectedMint) {
    throw new Error(
      `Project ${input.project_id} raises in a different token than requested: ` +
        `project tokenMint=${project.tokenMint}, requested token=${input.token} (expected mint ${expectedMint}). ` +
        `Contribute using the project's actual token.`,
    );
  }

  const amountBaseUnits = toBaseUnits(input.amount, input.token);
  const result = await api.post<TxBuildContributeResponse>(
    "/tx/build/contribute",
    { projectId: input.project_id, amount: amountBaseUnits },
    { authenticated: true },
  );

  return {
    unsigned_tx: result.unsignedTx,
    // A Solana signature is the ed25519 signature over the signed
    // transaction message, so it cannot be known before the caller signs
    // `unsigned_tx` locally — always null here (see schemas.ts).
    expected_sig: null,
    // Templated: substitute the real signature after signing `unsigned_tx`
    // and submitting it via POST {API_BASE_URL}/tx/send, which returns
    // `{ signature }`. GET this URL (with the signature substituted) to
    // poll confirmation (api/src/routes/tx.ts's GET /tx/:signature).
    confirmation_url: `${config.apiBaseUrl}/tx/{signature}`,
  };
}

export const donationAgent: AgentDefinition<typeof donationAgentInputSchema> = {
  manifest: donationAgentManifest,
  inputSchema: donationAgentInputSchema,
  execute,
};
