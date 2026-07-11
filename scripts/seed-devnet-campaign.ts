/**
 * seed-devnet-campaign.ts — DEVNET REHEARSAL of the $17k platform campaign.
 *
 * Uses the instruction builders directly (not the API) because the devnet
 * rehearsal runs without Pinata/Helius credentials: metadata pinning and
 * webhook indexing are exercised on mainnet with real keys, while this
 * script proves the on-chain path — register agent, create project +
 * initialize escrow ATOMICALLY (USDC/SPL branch: escrow ATA creation), on
 * a public cluster. The mainnet campaign itself is seeded through the API
 * via scripts/seed-first-campaign.ts.
 *
 * Idempotent: skips register_agent if the agent PDA exists, and derives
 * the next project index from the on-chain AgentAccount.
 *
 * Run (WSL):
 *   SOLANA_RPC_URL=https://api.devnet.solana.com \
 *   SOLANA_CLUSTER=devnet \
 *   REGISTRY_PROGRAM_ID=2TqDeKaadPUeBcgaXXqYAqddfZngUfbq4m8iDSyePSBA \
 *   ESCROW_PROGRAM_ID=HiuwNu1K927uTd8xvVCXUHvJW7BcBCgrNBAMC3qUN1Sz \
 *   REPUTATION_PROGRAM_ID=7DVKSmmhKVWW5JpwWCS89Fi6uwj3RaPADEBbVqyH8Zo7 \
 *   npx tsx scripts/seed-devnet-campaign.ts
 */
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { USDC_MINT } from "@agentfund/shared";
import {
  buildCreateProjectIx,
  buildInitializeEscrowIx,
  buildRegisterAgentIx,
  deriveAgentPda,
  deriveEscrowPda,
  deriveProjectPda,
  getAssociatedTokenAddress,
} from "../api/src/services/solana.js";

const USDC_DECIMALS = 6;
const GOAL_USDC = 17_000;
const DEADLINE_DAYS = 45;
const SECONDS_PER_DAY = 86_400;

// Devnet rehearsal marker — real IPFS metadata (title, description, founder
// note) is pinned via Pinata on mainnet through the API's create_project.
const REHEARSAL_IPFS_HASH = "devnet-rehearsal-agentfund-17k-v1";
const REHEARSAL_AGENT_URI = "https://predictbgmi.fun/meta/platform-agent.json";

function loadKeypair(): Keypair {
  const path = process.env.PLATFORM_WALLET_KEYPAIR_PATH ?? "~/.config/solana/id.json";
  const resolved = path.startsWith("~/") ? resolvePath(homedir(), path.slice(2)) : path;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(resolved, "utf8")) as number[]));
}

/** Reads projects_created from a raw AgentAccount: disc(8) + owner(32) + metadata_uri(4+len) + reputation_score(8) + projects_created(u32 LE). */
function parseProjectsCreated(data: Buffer): number {
  const uriLen = data.readUInt32LE(40);
  return data.readUInt32LE(40 + 4 + uriLen + 8);
}

async function main(): Promise<void> {
  const rpc = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  const conn = new Connection(rpc, "confirmed");
  const wallet = loadKeypair();
  const usdcMint = new PublicKey(USDC_MINT.devnet);

  console.log(`\nAgentFund devnet campaign rehearsal`);
  console.log(`cluster: ${rpc}`);
  console.log(`wallet:  ${wallet.publicKey.toBase58()}`);
  const balance = await conn.getBalance(wallet.publicKey);
  console.log(`balance: ${(balance / 1e9).toFixed(3)} SOL`);

  // ── 1. register agent (skip if PDA exists) ────────────────────
  const [agentPda] = deriveAgentPda(wallet.publicKey);
  let agentInfo = await conn.getAccountInfo(agentPda);
  if (!agentInfo) {
    const sig = await sendAndConfirmTransaction(
      conn,
      new Transaction().add(buildRegisterAgentIx({ owner: wallet.publicKey, metadataUri: REHEARSAL_AGENT_URI })),
      [wallet],
      { commitment: "confirmed" },
    );
    console.log(`registered agent: ${sig}`);
    agentInfo = await conn.getAccountInfo(agentPda);
  } else {
    console.log(`agent already registered: ${agentPda.toBase58()}`);
  }
  if (!agentInfo) throw new Error("agent account missing after registration");
  const projectIndex = parseProjectsCreated(agentInfo.data);

  // ── 2. create project + initialize escrow, ATOMIC (USDC branch) ──
  const [projectPda] = deriveProjectPda(wallet.publicKey, projectIndex);
  const [escrowPda] = deriveEscrowPda(projectPda);
  const escrowAta = getAssociatedTokenAddress(usdcMint, escrowPda);

  const goalAmount = GOAL_USDC * 10 ** USDC_DECIMALS;
  const deadline = Math.floor(Date.now() / 1000) + DEADLINE_DAYS * SECONDS_PER_DAY;

  const createIx = buildCreateProjectIx({
    creator: wallet.publicKey,
    projectIndex,
    ipfsHash: REHEARSAL_IPFS_HASH,
    goalAmount,
    tokenMint: usdcMint,
    deadline,
    milestoneCount: 4,
  });
  const initIx = buildInitializeEscrowIx({
    payer: wallet.publicKey,
    creator: wallet.publicKey,
    project: projectPda,
    goalAmount,
    deadline,
    milestoneCount: 4,
    tokenMint: usdcMint,
  });
  const sig = await sendAndConfirmTransaction(
    conn,
    new Transaction().add(createIx, initIx),
    [wallet],
    { commitment: "confirmed" },
  );

  console.log(`\ncampaign created (project + escrow atomic): ${sig}`);
  console.log(`  project PDA: ${projectPda.toBase58()}`);
  console.log(`  escrow PDA:  ${escrowPda.toBase58()}`);
  console.log(`  escrow USDC ATA: ${escrowAta.toBase58()}`);
  console.log(`  goal: ${GOAL_USDC.toLocaleString()} USDC — deadline in ${DEADLINE_DAYS} days — 4 milestones`);
  console.log(`\nexplorer:`);
  console.log(`  https://solscan.io/tx/${sig}?cluster=devnet`);
  console.log(`  https://solscan.io/account/${projectPda.toBase58()}?cluster=devnet`);

  // sanity: escrow ATA exists and is owned by the escrow PDA
  const ataInfo = await conn.getAccountInfo(escrowAta);
  console.log(`\nescrow ATA created: ${ataInfo ? "YES" : "NO"} (${ataInfo?.data.length ?? 0} bytes)`);
}

main().catch((err) => {
  console.error("fatal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
