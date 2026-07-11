/**
 * prove-escrow-flow.ts — end-to-end proof of the escrow program's security
 * properties against a LIVE validator, using the exact same instruction
 * builders the API serves from /tx/build/:action (api/src/services/solana.ts).
 *
 * Run (WSL, local validator on :8899 with the three programs loaded):
 *
 *   SOLANA_RPC_URL=http://127.0.0.1:8899 \
 *   REGISTRY_PROGRAM_ID=2TqDeKaadPUeBcgaXXqYAqddfZngUfbq4m8iDSyePSBA \
 *   ESCROW_PROGRAM_ID=HiuwNu1K927uTd8xvVCXUHvJW7BcBCgrNBAMC3qUN1Sz \
 *   REPUTATION_PROGRAM_ID=7DVKSmmhKVWW5JpwWCS89Fi6uwj3RaPADEBbVqyH8Zo7 \
 *   npx tsx scripts/prove-escrow-flow.ts
 *
 * Proves, in order:
 *   1. create_project + initialize_escrow land ATOMICALLY in one tx (finding #9).
 *   2. release_milestone is rejected before the funding goal is met (GoalNotMet
 *      — the fund-drain fix from REVIEW_FINDINGS #1).
 *   3. Non-contributors cannot vote (uninitialized ContributionAccount).
 *   4. Refund is rejected while the deadline has not passed (funds locked).
 *   5. Goal met + majority vote → milestone releases pay the recorded creator
 *      the exact expected amount; replaying the same milestone is rejected.
 *   6. Final milestone sweeps the remainder and completes the campaign;
 *      further releases are rejected.
 *   7. Failed campaign (deadline passed, goal unmet): release rejected,
 *      refund returns the contributor's full deposit.
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SendTransactionError,
  Transaction,
  sendAndConfirmTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { NATIVE_SOL_MINT } from "@agentfund/shared";
import {
  buildContributeIx,
  buildCreateProjectIx,
  buildInitializeEscrowIx,
  buildRefundIx,
  buildRegisterAgentIx,
  buildReleaseMilestoneIx,
  buildVoteMilestoneIx,
  deriveEscrowPda,
  deriveProjectPda,
  deriveVotePda,
} from "../api/src/services/solana.js";

const RPC = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const conn = new Connection(RPC, "confirmed");
const NATIVE_MINT = new PublicKey(NATIVE_SOL_MINT);

const SOL = LAMPORTS_PER_SOL;

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

async function sendTx(
  ixs: TransactionInstruction[],
  feePayer: Keypair,
  extraSigners: Keypair[] = [],
): Promise<string> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = feePayer.publicKey;
  return sendAndConfirmTransaction(conn, tx, [feePayer, ...extraSigners], {
    commitment: "confirmed",
  });
}

/** Runs `fn` expecting an on-chain rejection whose logs/message contain one of `expected`. */
async function expectFail(label: string, expected: string[], fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    fail(label, "transaction unexpectedly SUCCEEDED");
  } catch (err) {
    let text = err instanceof Error ? err.message : String(err);
    if (err instanceof SendTransactionError) {
      try {
        const logs = await err.getLogs(conn);
        text += "\n" + (logs ?? []).join("\n");
      } catch {
        text += "\n" + (err.logs ?? []).join("\n");
      }
    }
    const hit = expected.find((e) => text.includes(e));
    if (hit) pass(label, `rejected with ${hit}`);
    else fail(label, `rejected but with unexpected error:\n${text.slice(0, 600)}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function airdrop(pubkey: PublicKey, sol: number): Promise<void> {
  const sig = await conn.requestAirdrop(pubkey, sol * SOL);
  const bh = await conn.getLatestBlockhash("confirmed");
  await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
}

async function main(): Promise<void> {
  console.log(`\nAgentFund escrow live proof — RPC ${RPC}`);
  console.log(`escrow program: ${process.env.ESCROW_PROGRAM_ID}`);

  const creator = Keypair.generate();
  const alice = Keypair.generate();
  const bob = Keypair.generate();
  const mallory = Keypair.generate(); // never contributes — the adversary

  console.log(`\ncreator ${creator.publicKey.toBase58()}`);
  console.log(`alice   ${alice.publicKey.toBase58()}`);
  console.log(`bob     ${bob.publicKey.toBase58()}`);
  console.log(`mallory ${mallory.publicKey.toBase58()}`);

  console.log("\n[setup] airdropping 10 SOL to each wallet…");
  await Promise.all([
    airdrop(creator.publicKey, 10),
    airdrop(alice.publicKey, 10),
    airdrop(bob.publicKey, 10),
    airdrop(mallory.publicKey, 10),
  ]);

  // ── register creator as an agent ─────────────────────────────
  await sendTx([buildRegisterAgentIx({ owner: creator.publicKey, metadataUri: "ipfs://proof-agent" })], creator);
  pass("register_agent", "creator registered on agent_registry");

  const now = Math.floor(Date.now() / 1000);

  // ── Campaign B (refund path): goal 10 SOL, deadline in ~30s ──
  const [projectB] = deriveProjectPda(creator.publicKey, 0);
  const deadlineB = now + 30;
  {
    const createIx = buildCreateProjectIx({
      creator: creator.publicKey,
      projectIndex: 0,
      ipfsHash: "QmProofCampaignB",
      goalAmount: 10 * SOL,
      tokenMint: NATIVE_MINT,
      deadline: deadlineB,
      milestoneCount: 1,
    });
    const initIx = buildInitializeEscrowIx({
      payer: creator.publicKey,
      creator: creator.publicKey,
      project: projectB,
      goalAmount: 10 * SOL,
      deadline: deadlineB,
      milestoneCount: 1,
      tokenMint: NATIVE_MINT,
    });
    // Finding #9 proof: both instructions in ONE transaction.
    const sig = await sendTx([createIx, initIx], creator);
    pass("create_project + initialize_escrow ATOMIC (campaign B)", sig.slice(0, 20) + "…");
  }

  await sendTx(
    [buildContributeIx({ contributor: alice.publicKey, project: projectB, tokenMint: NATIVE_MINT, amount: 1 * SOL })],
    alice,
  );
  pass("contribute 1 SOL to campaign B (alice)");

  await expectFail("refund BEFORE deadline is rejected (campaign B)", ["DeadlineNotPassed", "0x177c", "custom program error"], () =>
    sendTx([buildRefundIx({ contributor: alice.publicKey, project: projectB, tokenMint: NATIVE_MINT })], alice),
  );

  // ── Campaign A (success path): goal 2 SOL, 2 milestones ──────
  const [projectA] = deriveProjectPda(creator.publicKey, 1);
  const [escrowA] = deriveEscrowPda(projectA);
  {
    const createIx = buildCreateProjectIx({
      creator: creator.publicKey,
      projectIndex: 1,
      ipfsHash: "QmProofCampaignA",
      goalAmount: 2 * SOL,
      tokenMint: NATIVE_MINT,
      deadline: now + 3600,
      milestoneCount: 2,
    });
    const initIx = buildInitializeEscrowIx({
      payer: creator.publicKey,
      creator: creator.publicKey,
      project: projectA,
      goalAmount: 2 * SOL,
      deadline: now + 3600,
      milestoneCount: 2,
      tokenMint: NATIVE_MINT,
    });
    await sendTx([createIx, initIx], creator);
    pass("create_project + initialize_escrow ATOMIC (campaign A)");
  }

  // THE fund-drain fix: no release before the goal is met, even with zero votes needed.
  await expectFail("release BEFORE goal met is rejected (GoalNotMet)", ["GoalNotMet"], () =>
    sendTx(
      [
        buildReleaseMilestoneIx({
          payer: mallory.publicKey,
          project: projectA,
          creator: creator.publicKey,
          tokenMint: NATIVE_MINT,
          milestoneIndex: 0,
        }),
      ],
      mallory,
    ),
  );

  await sendTx(
    [buildContributeIx({ contributor: alice.publicKey, project: projectA, tokenMint: NATIVE_MINT, amount: 1.5 * SOL })],
    alice,
  );
  await sendTx(
    [buildContributeIx({ contributor: bob.publicKey, project: projectA, tokenMint: NATIVE_MINT, amount: 0.8 * SOL })],
    bob,
  );
  const escrowBal = await conn.getBalance(escrowA);
  if (escrowBal >= 2.3 * SOL) pass("contributions escrowed", `escrow PDA holds ${(escrowBal / SOL).toFixed(3)} SOL (2.3 deposited + rent)`);
  else fail("contributions escrowed", `escrow PDA only holds ${escrowBal}`);

  await expectFail("non-contributor vote is rejected (mallory)", ["AccountNotInitialized", "0xbc4"], () =>
    sendTx(
      [buildVoteMilestoneIx({ voter: mallory.publicKey, project: projectA, milestoneIndex: 0, support: true })],
      mallory,
    ),
  );

  await sendTx([buildVoteMilestoneIx({ voter: alice.publicKey, project: projectA, milestoneIndex: 0, support: true })], alice);
  await sendTx([buildVoteMilestoneIx({ voter: bob.publicKey, project: projectA, milestoneIndex: 0, support: true })], bob);
  pass("weighted votes cast for milestone 0 (alice 1.5 + bob 0.8)");

  const [voteA0] = deriveVotePda(projectA, alice.publicKey, 0);
  const [voteB0] = deriveVotePda(projectA, bob.publicKey, 0);

  // Release milestone 0 as a permissionless crank (mallory pays the fee;
  // funds can only go to the RECORDED creator).
  const creatorBefore = await conn.getBalance(creator.publicKey);
  await sendTx(
    [
      buildReleaseMilestoneIx({
        payer: mallory.publicKey,
        project: projectA,
        creator: creator.publicKey,
        tokenMint: NATIVE_MINT,
        milestoneIndex: 0,
        voteAccounts: [voteA0, voteB0],
      }),
    ],
    mallory,
  );
  const creatorAfter = await conn.getBalance(creator.publicKey);
  const delta0 = creatorAfter - creatorBefore;
  const expected0 = Math.floor((2.3 * SOL) / 2); // total_deposited / milestone_count
  if (delta0 === expected0) pass("milestone 0 released to creator", `+${(delta0 / SOL).toFixed(3)} SOL (exactly total/2)`);
  else fail("milestone 0 released to creator", `expected +${expected0}, got +${delta0}`);

  await expectFail("replaying milestone 0 release is rejected", ["MilestoneOutOfOrder"], () =>
    sendTx(
      [
        buildReleaseMilestoneIx({
          payer: mallory.publicKey,
          project: projectA,
          creator: creator.publicKey,
          tokenMint: NATIVE_MINT,
          milestoneIndex: 0,
          voteAccounts: [voteA0, voteB0],
        }),
      ],
      mallory,
    ),
  );

  // Milestone 1 (final): vote + release sweeps the remainder, completes campaign.
  await sendTx([buildVoteMilestoneIx({ voter: alice.publicKey, project: projectA, milestoneIndex: 1, support: true })], alice);
  const [voteA1] = deriveVotePda(projectA, alice.publicKey, 1);
  const before1 = await conn.getBalance(creator.publicKey);
  await sendTx(
    [
      buildReleaseMilestoneIx({
        payer: creator.publicKey,
        project: projectA,
        creator: creator.publicKey,
        tokenMint: NATIVE_MINT,
        milestoneIndex: 1,
        voteAccounts: [voteA1],
      }),
    ],
    creator,
  );
  const after1 = await conn.getBalance(creator.publicKey);
  const delta1 = after1 - before1;
  const expected1 = 2.3 * SOL - expected0; // sweep of the remainder
  if (Math.abs(delta1 - expected1) <= 10_000) pass("final milestone sweeps remainder, campaign Completed", `+${(delta1 / SOL).toFixed(3)} SOL`);
  else fail("final milestone sweep", `expected ~+${expected1}, got +${delta1}`);

  await expectFail("release after completion is rejected", ["CampaignNotActive", "MilestoneOutOfOrder", "AllMilestonesReleased"], () =>
    sendTx(
      [
        buildReleaseMilestoneIx({
          payer: creator.publicKey,
          project: projectA,
          creator: creator.publicKey,
          tokenMint: NATIVE_MINT,
          milestoneIndex: 1,
          voteAccounts: [voteA1],
        }),
      ],
      creator,
    ),
  );

  // ── Campaign B failure path: deadline passes with goal unmet ──
  const waitMs = (deadlineB + 3) * 1000 - Date.now();
  if (waitMs > 0) {
    console.log(`\n[wait] letting campaign B's deadline pass (${Math.ceil(waitMs / 1000)}s)…`);
    await sleep(waitMs);
  }

  await expectFail("release on FAILED campaign is rejected (GoalNotMet)", ["GoalNotMet"], () =>
    sendTx(
      [
        buildReleaseMilestoneIx({
          payer: creator.publicKey,
          project: projectB,
          creator: creator.publicKey,
          tokenMint: NATIVE_MINT,
          milestoneIndex: 0,
        }),
      ],
      creator,
    ),
  );

  const aliceBefore = await conn.getBalance(alice.publicKey);
  await sendTx([buildRefundIx({ contributor: alice.publicKey, project: projectB, tokenMint: NATIVE_MINT })], alice);
  const aliceAfter = await conn.getBalance(alice.publicKey);
  const refunded = aliceAfter - aliceBefore;
  if (refunded >= 1 * SOL - 10_000) pass("refund returns full deposit after failed campaign", `alice +${(refunded / SOL).toFixed(4)} SOL (deposit + contribution-account rent − fee)`);
  else fail("refund", `alice only got back ${refunded}`);

  await expectFail("double refund is rejected", ["NothingToRefund", "AccountNotInitialized", "0xbc4"], () =>
    sendTx([buildRefundIx({ contributor: alice.publicKey, project: projectB, tokenMint: NATIVE_MINT })], alice),
  );

  // ── summary ──────────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`RESULT: ${passCount} passed, ${failCount} failed`);
  if (failCount > 0) {
    process.exitCode = 1;
  } else {
    console.log("All escrow security properties verified LIVE on-chain.");
  }
}

main().catch((err) => {
  console.error("\nfatal:", err instanceof Error ? err.message : err);
  if (err instanceof SendTransactionError) console.error((err.logs ?? []).join("\n"));
  process.exitCode = 1;
});
