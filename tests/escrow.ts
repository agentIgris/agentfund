/**
 * Anchor test suite for the `escrow` program (Program 2 per
 * implementation_plan.md). Exercises the SPL-token path end to end
 * (a locally-minted token standing in for USDC) against a project
 * identifier that is just an opaque `Pubkey` — this program does not
 * depend on `agent_registry` being deployed (see the design note atop
 * programs/escrow/src/lib.rs).
 *
 * Scenarios covered:
 *  - happy path: contribute + vote + release
 *  - double-vote rejected
 *  - refund before deadline rejected
 *  - refund after failed campaign succeeds
 *  - non-contributor vote rejected
 *  - out-of-order milestone rejected
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddress,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert, expect } from "chai";
import type { Escrow } from "../target/types/escrow";

const ESCROW_SEED = Buffer.from("escrow");
const CONTRIBUTION_SEED = Buffer.from("contribution");
const VOTE_SEED = Buffer.from("vote");

describe("escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Escrow as Program<Escrow>;
  const connection = provider.connection;

  let mint: PublicKey;
  let mintAuthority: Keypair;

  const creator = Keypair.generate();
  const contributor1 = Keypair.generate();
  const contributor2 = Keypair.generate();
  const nonContributor = Keypair.generate();

  const DECIMALS = 6;
  const CONTRIB_AMOUNT_1 = 6_000_000; // 6 USDC-equivalent
  const CONTRIB_AMOUNT_2 = 4_000_000; // 4 USDC-equivalent
  const GOAL_AMOUNT = 5_000_000; // goal met by contributor1 alone

  function escrowPda(project: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [ESCROW_SEED, project.toBuffer()],
      program.programId,
    );
  }

  function contributionPda(project: PublicKey, contributor: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [CONTRIBUTION_SEED, project.toBuffer(), contributor.toBuffer()],
      program.programId,
    );
  }

  function votePda(
    project: PublicKey,
    voter: PublicKey,
    milestoneIndex: number,
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [VOTE_SEED, project.toBuffer(), voter.toBuffer(), Buffer.from([milestoneIndex])],
      program.programId,
    );
  }

  async function airdrop(pubkey: PublicKey, sol = 2) {
    const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
  }

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function ataFor(owner: PublicKey) {
    return getOrCreateAssociatedTokenAccount(
      connection,
      mintAuthority,
      mint,
      owner,
      true,
    );
  }

  /** Initializes a fresh project/escrow pair and returns its identifiers. */
  async function setupEscrow(opts: {
    goalAmount: number;
    deadlineSecondsFromNow: number;
    milestoneCount: number;
  }) {
    const project = Keypair.generate().publicKey;
    const [escrow] = escrowPda(project);
    const escrowAta = await getAssociatedTokenAddress(mint, escrow, true);
    const deadline = Math.floor(Date.now() / 1000) + opts.deadlineSecondsFromNow;

    await program.methods
      .initializeEscrow(
        project,
        new anchor.BN(opts.goalAmount),
        new anchor.BN(deadline),
        opts.milestoneCount,
        mint,
        creator.publicKey,
      )
      .accounts({
        payer: provider.wallet.publicKey,
        escrow,
        mint,
        escrowAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { project, escrow, escrowAta, deadline };
  }

  async function contribute(
    project: PublicKey,
    escrow: PublicKey,
    escrowAta: PublicKey,
    contributor: Keypair,
    amount: number,
  ) {
    const [contribution] = contributionPda(project, contributor.publicKey);
    const contributorAta = await ataFor(contributor.publicKey);
    await program.methods
      .contribute(project, new anchor.BN(amount))
      .accounts({
        escrow,
        contribution,
        contributor: contributor.publicKey,
        contributorAta: contributorAta.address,
        escrowAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([contributor])
      .rpc();
    return { contribution, contributorAta: contributorAta.address };
  }

  before(async () => {
    await Promise.all([
      airdrop(creator.publicKey),
      airdrop(contributor1.publicKey),
      airdrop(contributor2.publicKey),
      airdrop(nonContributor.publicKey),
    ]);

    mintAuthority = Keypair.generate();
    await airdrop(mintAuthority.publicKey);
    mint = await createMint(
      connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      DECIMALS,
    );

    // contributor1 in particular is reused as the sole contributor across
    // several `it()` blocks below (double-vote, refund, non-contributor,
    // out-of-order) — mint generously so cumulative spend across the
    // whole suite never runs short.
    const MINT_AMOUNT = 100 * (CONTRIB_AMOUNT_1 + CONTRIB_AMOUNT_2);
    for (const wallet of [contributor1, contributor2]) {
      const ata = await ataFor(wallet.publicKey);
      await mintTo(connection, mintAuthority, mint, ata.address, mintAuthority, MINT_AMOUNT);
    }
  });

  it("happy path: contribute + vote + release", async () => {
    const { project, escrow, escrowAta } = await setupEscrow({
      goalAmount: GOAL_AMOUNT,
      deadlineSecondsFromNow: 3600,
      milestoneCount: 2,
    });

    await contribute(project, escrow, escrowAta, contributor1, CONTRIB_AMOUNT_1);
    const { contribution: contribution2 } = await contribute(
      project,
      escrow,
      escrowAta,
      contributor2,
      CONTRIB_AMOUNT_2,
    );

    let escrowState = await program.account.escrowAccount.fetch(escrow);
    assert.equal(
      escrowState.totalDeposited.toNumber(),
      CONTRIB_AMOUNT_1 + CONTRIB_AMOUNT_2,
    );

    // Both contributors vote in favor of milestone 0 — well over 50% of
    // total deposits.
    const [contribution1] = contributionPda(project, contributor1.publicKey);
    const [vote1] = votePda(project, contributor1.publicKey, 0);
    await program.methods
      .voteMilestone(project, 0, true)
      .accounts({
        escrow,
        contribution: contribution1,
        voteAccount: vote1,
        voter: contributor1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([contributor1])
      .rpc();

    const [vote2] = votePda(project, contributor2.publicKey, 0);
    await program.methods
      .voteMilestone(project, 0, true)
      .accounts({
        escrow,
        contribution: contribution2,
        voteAccount: vote2,
        voter: contributor2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([contributor2])
      .rpc();

    const creatorAta = await ataFor(creator.publicKey);

    await program.methods
      .releaseMilestone(project, 0)
      .accounts({
        escrow,
        creator: creator.publicKey,
        escrowAta,
        creatorAta: creatorAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: vote1, isWritable: false, isSigner: false },
        { pubkey: vote2, isWritable: false, isSigner: false },
      ])
      .rpc();

    escrowState = await program.account.escrowAccount.fetch(escrow);
    const total = CONTRIB_AMOUNT_1 + CONTRIB_AMOUNT_2;
    const expectedRelease = Math.floor(total / 2);
    assert.equal(escrowState.releasedAmount.toNumber(), expectedRelease);
    assert.equal(escrowState.milestoneIndex, 1);

    const creatorAccount = await getAccount(connection, creatorAta.address);
    assert.equal(Number(creatorAccount.amount), expectedRelease);
  });

  it("rejects a double vote from the same contributor on the same milestone", async () => {
    const { project, escrow, escrowAta } = await setupEscrow({
      goalAmount: GOAL_AMOUNT,
      deadlineSecondsFromNow: 3600,
      milestoneCount: 2,
    });
    const { contribution } = await contribute(
      project,
      escrow,
      escrowAta,
      contributor1,
      CONTRIB_AMOUNT_1,
    );
    const [vote] = votePda(project, contributor1.publicKey, 0);

    await program.methods
      .voteMilestone(project, 0, true)
      .accounts({
        escrow,
        contribution,
        voteAccount: vote,
        voter: contributor1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([contributor1])
      .rpc();

    let threw = false;
    try {
      await program.methods
        .voteMilestone(project, 0, true)
        .accounts({
          escrow,
          contribution,
          voteAccount: vote,
          voter: contributor1.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([contributor1])
        .rpc();
    } catch (err) {
      threw = true;
      // Anchor's `init` constraint rejects re-initializing an
      // already-allocated PDA — this is the mechanism the spec calls
      // out ("init prevents double vote").
      expect(String(err)).to.match(/already in use|0x0|already been processed/i);
    }
    assert.isTrue(threw, "expected double-vote to be rejected");
  });

  it("rejects refund before the deadline has passed", async () => {
    const { project, escrow, escrowAta } = await setupEscrow({
      goalAmount: GOAL_AMOUNT,
      deadlineSecondsFromNow: 3600,
      milestoneCount: 2,
    });
    const { contribution, contributorAta } = await contribute(
      project,
      escrow,
      escrowAta,
      contributor1,
      1_000_000,
    );

    let threw = false;
    try {
      await program.methods
        .refund(project)
        .accounts({
          escrow,
          contribution,
          contributor: contributor1.publicKey,
          escrowAta,
          contributorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([contributor1])
        .rpc();
    } catch (err) {
      threw = true;
      expect(String(err)).to.match(/DeadlineNotPassed/);
    }
    assert.isTrue(threw, "expected refund before deadline to be rejected");
  });

  it("allows refund after a failed campaign (deadline passed, goal not met)", async () => {
    const { project, escrow, escrowAta } = await setupEscrow({
      goalAmount: GOAL_AMOUNT, // 5_000_000 — deliberately not reached below
      deadlineSecondsFromNow: 6,
      milestoneCount: 2,
    });
    const { contribution, contributorAta } = await contribute(
      project,
      escrow,
      escrowAta,
      contributor1,
      1_000_000, // well under GOAL_AMOUNT
    );

    const before = await getAccount(connection, contributorAta);

    // Wait out the short deadline.
    await sleep(8_000);

    await program.methods
      .refund(project)
      .accounts({
        escrow,
        contribution,
        contributor: contributor1.publicKey,
        escrowAta,
        contributorAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([contributor1])
      .rpc();

    const after = await getAccount(connection, contributorAta);
    assert.equal(Number(after.amount) - Number(before.amount), 1_000_000);

    const escrowState = await program.account.escrowAccount.fetch(escrow);
    assert.equal(escrowState.totalDeposited.toNumber(), 0);

    // ContributionAccount was closed back to the contributor.
    const contributionInfo = await connection.getAccountInfo(contribution);
    assert.isNull(contributionInfo);
  });

  it("rejects a vote from a wallet with no ContributionAccount", async () => {
    const { project, escrow, escrowAta } = await setupEscrow({
      goalAmount: GOAL_AMOUNT,
      deadlineSecondsFromNow: 3600,
      milestoneCount: 2,
    });
    await contribute(project, escrow, escrowAta, contributor1, CONTRIB_AMOUNT_1);

    const [bogusContribution] = contributionPda(project, nonContributor.publicKey);
    const [vote] = votePda(project, nonContributor.publicKey, 0);

    let threw = false;
    try {
      await program.methods
        .voteMilestone(project, 0, true)
        .accounts({
          escrow,
          contribution: bogusContribution,
          voteAccount: vote,
          voter: nonContributor.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([nonContributor])
        .rpc();
    } catch (err) {
      threw = true;
      expect(String(err)).to.match(/AccountNotInitialized|AccountOwnedByWrongProgram/);
    }
    assert.isTrue(threw, "expected vote from a non-contributor to be rejected");
  });

  it("rejects releasing a milestone out of order", async () => {
    const { project, escrow, escrowAta } = await setupEscrow({
      goalAmount: GOAL_AMOUNT,
      deadlineSecondsFromNow: 3600,
      milestoneCount: 3,
    });
    const { contribution } = await contribute(
      project,
      escrow,
      escrowAta,
      contributor1,
      CONTRIB_AMOUNT_1,
    );
    const [vote] = votePda(project, contributor1.publicKey, 0);
    await program.methods
      .voteMilestone(project, 0, true)
      .accounts({
        escrow,
        contribution,
        voteAccount: vote,
        voter: contributor1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([contributor1])
      .rpc();

    const creatorAta = await ataFor(creator.publicKey);

    let threw = false;
    try {
      // escrow.milestoneIndex is still 0 — attempting index 1 must fail.
      await program.methods
        .releaseMilestone(project, 1)
        .accounts({
          escrow,
          creator: creator.publicKey,
          escrowAta,
          creatorAta: creatorAta.address,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([{ pubkey: vote, isWritable: false, isSigner: false }])
        .rpc();
    } catch (err) {
      threw = true;
      expect(String(err)).to.match(/MilestoneOutOfOrder/);
    }
    assert.isTrue(threw, "expected out-of-order milestone release to be rejected");
  });
});
