/**
 * e2e.ts — the AUTHORIZED end-to-end devnet proof of the customer
 * journey, run as one of the three team-owned keypairs in
 * E:\AIfundraising\devnet-agents\ (never a third-party agent). Flow:
 *
 *   1. GET /llms.txt from the live API (discovery, as any agent would do).
 *   2. Register the test agent on-chain (idempotent).
 *   3. Fund it with devnet SOL (airdrop) and devnet USDC. Circle's devnet
 *      USDC faucet (faucet.circle.com) is browser/captcha-only and cannot
 *      be scripted (documented blocker, DEPLOYMENT.md ¶"Original blocker
 *      record") — instead this transfers a small amount of devnet USDC
 *      already held by the deploy wallet (itself originally faucet-funded
 *      by a human, per DEPLOYMENT.md's x402 smoke test) to the test agent.
 *      Same authorized funds, same devnet USDC mint, no captcha needed.
 *   4. Create a project titled with an "[E2E-TEST]" prefix, PLUS its escrow
 *      account. Built and sent directly against the registry/escrow
 *      programs (buildCreateProjectIx / buildInitializeEscrowIx from
 *      api/src/services/solana.ts), bypassing the HTTP
 *      POST /tx/build/create_project route entirely — that route
 *      unconditionally calls Pinata to pin the metadata JSON
 *      (services/ipfs.ts's pinProjectMetadata) with no bypass, and
 *      production has no PINATA_JWT configured, so it 500s for every
 *      caller today (a genuine platform bug, confirmed live during this
 *      test run — see the final report). This mirrors the exact pattern
 *      already established in scripts/devnet-update-genesis-metadata.ts
 *      and scripts/prove-update-metadata.ts. The `ipfs_hash` used here is
 *      a plain placeholder string (not a resolvable CID/URL) — the
 *      indexer's ProjectCreated handler tolerates unresolvable metadata
 *      with a graceful `{title: <pubkey>, description: ""}` fallback (see
 *      services/indexer.ts), so the test project still gets indexed.
 *   5. Wait for the production indexer (Helius webhook -> DB) to pick up
 *      the on-chain ProjectCreated event, then donate via the live x402
 *      flow (402 -> sign -> X-PAYMENT retry) — x402's settlement route
 *      looks the project up by DB row and requires status "Active", so
 *      this step cannot bypass the live API the way step 4 did.
 *   6. Vote to support its one milestone.
 *   7. Mark the test project's status Complete as an explicit "this is a
 *      finished test, ignore it" cleanup signal (no delete instruction
 *      exists on-chain; escrow accounts are permanent by design).
 *
 * Every transaction signature is printed for the final report.
 *
 * Run:
 *   E2E_AGENT_KEYPAIR_PATH=/mnt/e/AIfundraising/devnet-agents/research-agent.json \
 *   DEPLOY_WALLET_PATH=$HOME/.config/solana/id.json \
 *   OUTREACH_API_URL=https://api.agentfund.online \
 *   SOLANA_RPC_URL=https://api.devnet.solana.com \
 *   npx tsx src/e2e.ts
 */
import os from "node:os";
import path from "node:path";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import { AgentFundClient } from "@agentfund/sdk";
import { USDC_MINT } from "@agentfund/shared";
import {
  buildUpdateProjectStatusIx,
  buildCreateProjectIx,
  buildInitializeEscrowIx,
  deriveAgentPda,
  deriveProjectPda,
} from "../../api/src/services/solana.js";
import { loadConfig, loadKeypairFile } from "./config.js";

function loadKeypair(filePath: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(loadKeypairFile(filePath)));
}

/**
 * Reads AgentAccount.projects_created directly from chain (same decode
 * offsets as discovery.ts's decodeAgentAccount): 8 (disc) + owner (32) +
 * metadata_uri (Borsh String) + reputation_score (u64, 8), then a u32.
 */
async function readProjectsCreated(connection: Connection, owner: PublicKey): Promise<number> {
  const [agentPda] = deriveAgentPda(owner);
  const info = await connection.getAccountInfo(agentPda, "confirmed");
  if (!info) throw new Error(`AgentAccount not found for ${owner.toBase58()} — must be registered first`);
  const data = info.data;
  let offset = 8 + 32;
  const uriLen = data.readUInt32LE(offset);
  offset += 4 + uriLen;
  offset += 8; // reputation_score
  return data.readUInt32LE(offset);
}

/** Polls GET {apiUrl}/projects/:id until the production indexer has picked up ProjectCreated. */
async function waitForIndexed(apiUrl: string, projectId: string, timeoutMs = 45_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${apiUrl}/projects/${projectId}`);
    if (res.status === 200) return true;
    await new Promise((r) => setTimeout(r, 2500));
  }
  return false;
}

async function ensureFunded(connection: Connection, agent: Keypair): Promise<void> {
  const bal = await connection.getBalance(agent.publicKey, "confirmed");
  console.log(`agent SOL balance: ${bal / 1e9}`);
  if (bal < 0.05 * 1e9) {
    console.log("requesting devnet SOL airdrop for the test agent…");
    const sig = await connection.requestAirdrop(agent.publicKey, 1e9);
    const bh = await connection.getLatestBlockhash("confirmed");
    await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    console.log(`  airdrop tx: ${sig}`);
  }
}

async function ensureUsdcFunded(
  connection: Connection,
  funder: Keypair,
  agent: Keypair,
  mint: PublicKey,
  amountMicroUsdc: number,
): Promise<void> {
  const funderAta = await getAssociatedTokenAddress(mint, funder.publicKey);
  const agentAta = await getAssociatedTokenAddress(mint, agent.publicKey);

  const ixs = [];
  const agentAtaInfo = await connection.getAccountInfo(agentAta, "confirmed");
  if (!agentAtaInfo) {
    ixs.push(createAssociatedTokenAccountInstruction(funder.publicKey, agentAta, agent.publicKey, mint));
  }

  let agentBalance = 0n;
  try {
    agentBalance = (await getAccount(connection, agentAta, "confirmed")).amount;
  } catch {
    // ATA doesn't exist yet — created above, balance is 0.
  }
  console.log(`agent USDC balance: ${Number(agentBalance) / 1e6}`);

  if (agentBalance >= BigInt(amountMicroUsdc)) {
    console.log("agent already has enough devnet USDC — skipping transfer.");
    return;
  }

  const need = amountMicroUsdc - Number(agentBalance);
  ixs.push(createTransferInstruction(funderAta, agentAta, funder.publicKey, need));

  const tx = new Transaction().add(...ixs);
  const sig = await sendAndConfirmTransaction(connection, tx, [funder], { commitment: "confirmed" });
  console.log(`  USDC funding transfer tx (${need / 1e6} USDC, from the deploy wallet's existing devnet ` +
    `USDC — Circle's faucet is browser/captcha-only, see DEPLOYMENT.md): ${sig}`);
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const agentKeypairPath =
    process.env.E2E_AGENT_KEYPAIR_PATH ??
    path.join(process.cwd(), "..", "devnet-agents", "research-agent.json");
  const deployWalletPath = process.env.DEPLOY_WALLET_PATH ?? path.join(os.homedir(), ".config/solana/id.json");

  const agent = loadKeypair(agentKeypairPath);
  const funder = loadKeypair(deployWalletPath);
  console.log(`test agent:   ${agent.publicKey.toBase58()} (${agentKeypairPath})`);
  console.log(`funder:       ${funder.publicKey.toBase58()}`);
  console.log(`API:          ${cfg.apiUrl}`);
  console.log(`RPC:          ${cfg.solanaRpcUrl}`);

  const connection = new Connection(cfg.solanaRpcUrl, "confirmed");
  const usdcMint = new PublicKey(USDC_MINT.devnet);

  // ── 1. discovery: read /llms.txt as any agent would ─────────
  const llmsRes = await fetch(`${cfg.apiUrl}/llms.txt`);
  console.log(`\nGET /llms.txt -> ${llmsRes.status}`);
  if (llmsRes.status !== 200) throw new Error(`/llms.txt did not return 200 (got ${llmsRes.status})`);
  const llmsText = await llmsRes.text();
  console.log(`  (${llmsText.length} bytes) first 200 chars:\n  ${llmsText.slice(0, 200).replace(/\n/g, " ")}`);

  // ── 2/3. fund + register ─────────────────────────────────────
  await ensureFunded(connection, agent);
  await ensureUsdcFunded(connection, funder, agent, usdcMint, 2_000_000); // 2 USDC

  const client = new AgentFundClient({ apiUrl: cfg.apiUrl, keypair: agent });
  console.log("\nauthenticating…");
  await client.authenticate();

  const existingAgent = await client.getAgent(agent.publicKey.toBase58()).catch(() => null);
  if (!existingAgent) {
    const { signature } = await client.registerAgent({
      metadataUri: "ipfs://e2e-test-agent",
      name: "AgentFund E2E Test Agent (research-agent)",
      description: "Team-controlled devnet keypair used only for authorized end-to-end platform testing.",
    });
    console.log(`register_agent tx: ${signature}`);
  } else {
    console.log("agent already registered on-chain.");
  }

  // ── 4. create the E2E test project + its escrow, built + sent directly ──
  // (bypasses the Pinata-dependent POST /tx/build/create_project route —
  // see the file header comment for why).
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const goalAmount = 1_000_000; // 1 USDC
  const projectIndex = await readProjectsCreated(connection, agent.publicKey);
  const [projectPda] = deriveProjectPda(agent.publicKey, projectIndex);
  const projectId = projectPda.toBase58();
  // On-chain ipfs_hash is capped at MAX_IPFS_HASH_LEN=128 bytes
  // (programs/agent_registry/src/lib.rs) — keep this short and ASCII-only.
  const placeholderIpfsHash = "e2e-test-placeholder-no-pinata";

  const createIx = buildCreateProjectIx({
    creator: agent.publicKey,
    projectIndex,
    ipfsHash: placeholderIpfsHash,
    goalAmount,
    tokenMint: usdcMint,
    deadline,
    milestoneCount: 1,
  });
  const initEscrowIx = buildInitializeEscrowIx({
    payer: agent.publicKey,
    creator: agent.publicKey,
    project: projectPda,
    goalAmount,
    deadline,
    milestoneCount: 1,
    tokenMint: usdcMint,
  });
  const createTx = new Transaction().add(createIx, initEscrowIx);
  const createSig = await sendAndConfirmTransaction(connection, createTx, [agent], { commitment: "confirmed" });
  console.log(`\ncreate_project + initialize_escrow tx: ${createSig}`);
  console.log(`  projectId (PDA): ${projectId}  (index ${projectIndex})`);
  console.log(
    `  title: "[E2E-TEST] AgentFund outreach-agent verification run" ` +
      `(not stored on-chain — only in the metadata JSON that would normally be pinned; this run's ` +
      `on-chain ipfs_hash is the placeholder string above since Pinata is unavailable)`,
  );

  // ── 5. wait for the production indexer, then donate via the live x402 flow ──
  console.log("\nwaiting for the production indexer to pick up ProjectCreated…");
  const indexed = await waitForIndexed(cfg.apiUrl, projectId);
  console.log(indexed ? "  indexed." : "  WARNING: not indexed within timeout — attempting donation anyway.");

  console.log("\ndonating 0.5 USDC via x402 (402 -> sign -> X-PAYMENT retry)…");
  const { signature: donateSig, receipt } = await client.donateViaX402({ projectId, amount: 500_000 });
  console.log(`donateViaX402 tx: ${donateSig}`);
  console.log(`  receipt:`, receipt);

  // ── 6. vote to support the milestone ─────────────────────────
  const { signature: voteSig } = await client.vote({ projectId, milestoneIndex: 0, support: true });
  console.log(`\nvote tx: ${voteSig}`);

  // ── 7. cleanup: mark the test project Complete ───────────────
  const statusIx = buildUpdateProjectStatusIx({
    authority: agent.publicKey,
    project: new PublicKey(projectId),
    status: "Complete",
  });
  const statusTx = new Transaction().add(statusIx);
  const statusSig = await sendAndConfirmTransaction(connection, statusTx, [agent], { commitment: "confirmed" });
  console.log(`\nupdate_project_status(Complete) tx (cleanup marker): ${statusSig}`);

  console.log("\n=== E2E RUN COMPLETE ===");
  console.log(
    JSON.stringify(
      {
        projectId,
        txs: {
          register_agent: existingAgent ? "(already registered)" : "(see above)",
          create_project: createSig,
          donate_x402: donateSig,
          vote: voteSig,
          update_project_status_complete: statusSig,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("E2E RUN FAILED:", err);
  process.exit(1);
});
