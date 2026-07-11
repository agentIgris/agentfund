/**
 * prove-x402-live.ts — full-stack, LIVE end-to-end proof of the x402
 * donation flow: real API server (Fastify + Postgres + Redis), real SDK
 * (`donateViaX402()`), real programs on a local validator. Also proves the
 * reputation write path (#10) live: platform-signed `update_reputation`
 * lands on-chain and the score moves by the point table's exact delta.
 *
 * Prereqs: local validator with the three programs loaded, Postgres +
 * Redis up, `prisma db push` applied, and the API running on :4000 with
 * the same env (see LOCAL_VALIDATOR.md).
 *
 * Run (WSL):
 *
 *   SOLANA_RPC_URL=http://127.0.0.1:8899 \
 *   REGISTRY_PROGRAM_ID=2TqDeKaadPUeBcgaXXqYAqddfZngUfbq4m8iDSyePSBA \
 *   ESCROW_PROGRAM_ID=HiuwNu1K927uTd8xvVCXUHvJW7BcBCgrNBAMC3qUN1Sz \
 *   REPUTATION_PROGRAM_ID=7DVKSmmhKVWW5JpwWCS89Fi6uwj3RaPADEBbVqyH8Zo7 \
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/agentfund \
 *   REPUTATION_AUTHORITY_SECRET="$(cat ~/.config/solana/id.json)" \
 *   API_URL=http://127.0.0.1:4000 \
 *   npx tsx scripts/prove-x402-live.ts
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { PrismaClient } from "@prisma/client";
import { NATIVE_SOL_MINT } from "@agentfund/shared";
import {
  buildContributeIx,
  buildCreateProjectIx,
  buildInitializeEscrowIx,
  buildRegisterAgentIx,
  deriveEscrowPda,
  deriveProjectPda,
} from "../api/src/services/solana.js";
import { deriveReputationPda } from "../api/src/services/reputationIx.js";
import { applyReputationEvent } from "../api/src/services/reputationWriter.js";
import { AgentFundClient } from "../sdk/src/client.js";

const RPC = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";
const SOL = LAMPORTS_PER_SOL;
const NATIVE_MINT = new PublicKey(NATIVE_SOL_MINT);

const conn = new Connection(RPC, "confirmed");
const prisma = new PrismaClient();

let passCount = 0;
let failCount = 0;
function pass(label: string, detail = ""): void {
  passCount += 1;
  console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
}
function fail(label: string, detail = ""): void {
  failCount += 1;
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function airdrop(pubkey: PublicKey, sol: number): Promise<void> {
  const sig = await conn.requestAirdrop(pubkey, sol * SOL);
  const bh = await conn.getLatestBlockhash("confirmed");
  await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
}

async function sendTx(ixs: Parameters<Transaction["add"]>, feePayer: Keypair): Promise<string> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = feePayer.publicKey;
  return sendAndConfirmTransaction(conn, tx, [feePayer], { commitment: "confirmed" });
}

async function main(): Promise<void> {
  console.log(`\nAgentFund x402 live proof — API ${API_URL}, RPC ${RPC}`);

  // ── sanity: API is up ─────────────────────────────────────────
  const health = await fetch(`${API_URL}/health`).catch(() => null);
  if (!health?.ok) {
    throw new Error(`API is not reachable at ${API_URL} — start it first (see script header).`);
  }
  pass("API reachable", `/health ${health.status}`);

  // ── on-chain setup: creator registers + creates project ──────
  const creator = Keypair.generate();
  const donor = Keypair.generate();
  await Promise.all([airdrop(creator.publicKey, 10), airdrop(donor.publicKey, 10)]);

  const now = Math.floor(Date.now() / 1000);
  const [projectPda] = deriveProjectPda(creator.publicKey, 0);
  const [escrowPda] = deriveEscrowPda(projectPda);

  await sendTx(
    [buildRegisterAgentIx({ owner: creator.publicKey, metadataUri: "ipfs://x402-proof-agent" })],
    creator,
  );
  await sendTx(
    [
      buildCreateProjectIx({
        creator: creator.publicKey,
        projectIndex: 0,
        ipfsHash: "QmX402ProofProject",
        goalAmount: 2 * SOL,
        tokenMint: NATIVE_MINT,
        deadline: now + 3600,
        milestoneCount: 1,
      }),
      buildInitializeEscrowIx({
        payer: creator.publicKey,
        creator: creator.publicKey,
        project: projectPda,
        goalAmount: 2 * SOL,
        deadline: now + 3600,
        milestoneCount: 1,
        tokenMint: NATIVE_MINT,
      }),
    ],
    creator,
  );
  pass("on-chain project + escrow created", projectPda.toBase58());

  // ── DB seed — the Helius indexer does this in production; the local
  // validator has no webhook source, so we persist the rows directly. ──
  await prisma.agent.upsert({
    where: { owner: creator.publicKey.toBase58() },
    create: {
      owner: creator.publicKey.toBase58(),
      metadataUri: "ipfs://x402-proof-agent",
      projectsCreated: 1,
    },
    update: { projectsCreated: 1 },
  });
  await prisma.project.upsert({
    where: { id: projectPda.toBase58() },
    create: {
      id: projectPda.toBase58(),
      creator: creator.publicKey.toBase58(),
      projectIndex: 0,
      ipfsHash: "QmX402ProofProject",
      title: "x402 Live Proof Project",
      description: "Fixture project for the live x402 donation proof.",
      goalAmount: BigInt(2 * SOL),
      tokenMint: NATIVE_SOL_MINT,
      deadline: BigInt(now + 3600),
      milestoneCount: 1,
    },
    update: {},
  });
  pass("project row seeded in Postgres");

  // ── THE x402 FLOW — via the SDK, exactly as an external agent would ──
  const donateAmount = 0.75 * SOL;
  const escrowBefore = await conn.getBalance(escrowPda);

  const client = new AgentFundClient({ apiUrl: API_URL, keypair: donor });
  const { signature, receipt } = await client.donateViaX402({
    projectId: projectPda.toBase58(),
    amount: donateAmount,
  });
  pass("donateViaX402 settled", signature.slice(0, 20) + "…");

  if (receipt?.success && receipt.payer === donor.publicKey.toBase58()) {
    pass("X-PAYMENT-RESPONSE receipt", `network=${receipt.network}, payer=donor`);
  } else {
    fail("X-PAYMENT-RESPONSE receipt", JSON.stringify(receipt));
  }

  const escrowAfter = await conn.getBalance(escrowPda);
  if (escrowAfter - escrowBefore === donateAmount) {
    pass("escrow received exactly the donated amount", `+${(donateAmount / SOL).toFixed(2)} SOL`);
  } else {
    fail("escrow balance delta", `expected +${donateAmount}, got +${escrowAfter - escrowBefore}`);
  }

  // ── negative: a payment for LESS than the quoted amount is rejected ──
  {
    const cheapIx = buildContributeIx({
      contributor: donor.publicKey,
      project: projectPda,
      tokenMint: NATIVE_MINT,
      amount: 0.01 * SOL, // quote will demand 1 SOL
    });
    const bh = await conn.getLatestBlockhash("confirmed");
    const cheapTx = new Transaction({ feePayer: donor.publicKey, ...bh }).add(cheapIx);
    cheapTx.sign(donor);
    const header = Buffer.from(
      JSON.stringify({
        x402Version: 1,
        scheme: "exact",
        network: "solana-localnet",
        payload: { signedTx: cheapTx.serialize().toString("base64") },
      }),
    ).toString("base64");
    const res = await fetch(`${API_URL}/x402/donate/${projectPda.toBase58()}`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-PAYMENT": header },
      body: JSON.stringify({ amount: 1 * SOL }),
    });
    const body = (await res.json()) as { error?: string };
    if (res.status === 400 && body.error === "invalid_payment") {
      pass("underpayment rejected", "signed 0.01 SOL against a 1 SOL quote → invalid_payment");
    } else {
      fail("underpayment rejected", `status ${res.status}: ${JSON.stringify(body)}`);
    }
  }

  // ── negative: unknown project 404s before any payment parsing ──
  {
    const ghost = Keypair.generate().publicKey.toBase58();
    const res = await fetch(`${API_URL}/x402/donate/${ghost}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 1000 }),
    });
    if (res.status === 404) pass("unknown project → 404");
    else fail("unknown project → 404", `got ${res.status}`);
  }

  // ── reputation write path (#10), live ─────────────────────────
  // Config PDA is initialized by scripts/init-reputation-config.ts (run
  // before this script); here we apply a ContributionMade event exactly
  // the way the indexer does and read the score back from the chain.
  const before = await conn.getAccountInfo(deriveReputationPda(donor.publicKey)[0]);
  await applyReputationEvent({
    agentWallet: donor.publicKey.toBase58(),
    reason: "ContributionMade",
  });
  const repInfo = await conn.getAccountInfo(deriveReputationPda(donor.publicKey)[0]);
  if (!repInfo) {
    fail("reputation write", "ReputationAccount PDA was not created");
  } else {
    // ReputationAccount layout: discriminator(8) + agent pubkey(32) + score u64 LE.
    const score = repInfo.data.readBigUInt64LE(40);
    const expected = 100n + 5n; // INITIAL_SCORE + ContributionMade delta
    if (score === expected && before === null) {
      pass("reputation write path live", `init_reputation + update_reputation in one tx → score ${score} (100 initial + 5 donation)`);
    } else {
      fail("reputation write path", `expected score ${expected} on fresh account, got ${score}`);
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`RESULT: ${passCount} passed, ${failCount} failed`);
  if (failCount > 0) process.exitCode = 1;
  else console.log("x402 donation + reputation write proven LIVE end-to-end.");
}

main()
  .catch((err) => {
    console.error("\nfatal:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
