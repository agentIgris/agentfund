/**
 * Anchor test suite for the `reputation` program.
 *
 * Covers:
 *  - init_reputation (permissionless ReputationAccount PDA creation,
 *    starting score of 100)
 *  - update_reputation applying a point-table delta when called by the
 *    platform authority stored in the Config PDA
 *  - update_reputation rejecting a non-authority signer
 *  - update_reputation saturating the score at 0 instead of underflowing
 *    when repeated negative deltas would otherwise go negative
 *
 * Run via `anchor test` (Anchor.toml wires this into
 * `ts-mocha -p ./tsconfig.json -t 1000000 tests/**\/*.ts`), against
 * whatever cluster `--provider.cluster` / ANCHOR_PROVIDER_URL resolve to
 * (defaults to a local validator).
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorError } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Connection,
} from "@solana/web3.js";
import { expect } from "chai";

const CONFIG_SEED = Buffer.from("config");
const REPUTATION_SEED = Buffer.from("reputation");

// Mirrors the on-chain ReputationReason point table
// (programs/reputation/src/lib.rs) — reason code -> point delta.
const REASON = {
  MilestoneReleased: 0, // +15
  ContributionMade: 1, // +5
  VoteCast: 2, // +2
  GoalReached: 3, // +50
  ProjectRefunded: 4, // -20
  ProjectFlaggedFraudulent: 5, // -50
} as const;

const INITIAL_SCORE = 100;

async function airdrop(
  connection: Connection,
  pubkey: PublicKey,
  sol: number,
): Promise<void> {
  const signature = await connection.requestAirdrop(
    pubkey,
    sol * LAMPORTS_PER_SOL,
  );
  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({
    signature,
    ...latestBlockhash,
  });
}

describe("reputation", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Untyped against the generated IDL types (target/types/reputation is
  // produced by `anchor build`, which this workspace does not run) —
  // `program.methods` / `program.account` still resolve dynamically from
  // the loaded IDL at runtime.
  const program = anchor.workspace.Reputation as Program;
  const connection = provider.connection;

  const platformAuthority = Keypair.generate();
  const outsider = Keypair.generate();
  const agent = Keypair.generate();

  const [configPda] = PublicKey.findProgramAddressSync(
    [CONFIG_SEED],
    program.programId,
  );
  const [reputationPda] = PublicKey.findProgramAddressSync(
    [REPUTATION_SEED, agent.publicKey.toBuffer()],
    program.programId,
  );

  before(async () => {
    await airdrop(connection, platformAuthority.publicKey, 2);
    await airdrop(connection, outsider.publicKey, 2);

    // Platform Config PDA — authority is a distinct keypair from
    // `outsider` so the authorization test is unambiguous.
    await program.methods
      .initialize(platformAuthority.publicKey)
      .accounts({
        payer: provider.wallet.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  it("permissionlessly initializes an agent's reputation account at score 100", async () => {
    // Called by `outsider`, not the agent itself or the platform
    // authority — init_reputation must accept any payer.
    await program.methods
      .initReputation()
      .accounts({
        payer: outsider.publicKey,
        agent: agent.publicKey,
        reputation: reputationPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([outsider])
      .rpc();

    const reputationAccount = await program.account.reputationAccount.fetch(
      reputationPda,
    );
    expect(reputationAccount.agent.toBase58()).to.equal(
      agent.publicKey.toBase58(),
    );
    expect(reputationAccount.score.toNumber()).to.equal(INITIAL_SCORE);
    expect(reputationAccount.eventsCount).to.equal(0);
  });

  it("applies a point-table delta when called by the platform authority", async () => {
    await program.methods
      .updateReputation(new anchor.BN(15), REASON.MilestoneReleased)
      .accounts({
        authority: platformAuthority.publicKey,
        config: configPda,
        agent: agent.publicKey,
        reputation: reputationPda,
      })
      .signers([platformAuthority])
      .rpc();

    const reputationAccount = await program.account.reputationAccount.fetch(
      reputationPda,
    );
    expect(reputationAccount.score.toNumber()).to.equal(INITIAL_SCORE + 15);
    expect(reputationAccount.eventsCount).to.equal(1);
  });

  it("rejects update_reputation from a non-authority signer", async () => {
    try {
      await program.methods
        .updateReputation(new anchor.BN(5), REASON.ContributionMade)
        .accounts({
          authority: outsider.publicKey,
          config: configPda,
          agent: agent.publicKey,
          reputation: reputationPda,
        })
        .signers([outsider])
        .rpc();
      expect.fail(
        "expected update_reputation to reject a non-authority signer",
      );
    } catch (err) {
      const anchorErr = err as AnchorError;
      expect(anchorErr.error?.errorCode?.code).to.equal("Unauthorized");
    }
  });

  it("saturates the score at 0 instead of underflowing", async () => {
    // Score is currently 115. Two -50 "flagged fraudulent" penalties
    // would bring a raw i64 accumulator to 15, so a third must not go
    // negative — it should saturate at 0 instead.
    for (let i = 0; i < 2; i++) {
      await program.methods
        .updateReputation(
          new anchor.BN(-50),
          REASON.ProjectFlaggedFraudulent,
        )
        .accounts({
          authority: platformAuthority.publicKey,
          config: configPda,
          agent: agent.publicKey,
          reputation: reputationPda,
        })
        .signers([platformAuthority])
        .rpc();
    }

    let reputationAccount = await program.account.reputationAccount.fetch(
      reputationPda,
    );
    expect(reputationAccount.score.toNumber()).to.equal(15);

    await program.methods
      .updateReputation(new anchor.BN(-50), REASON.ProjectFlaggedFraudulent)
      .accounts({
        authority: platformAuthority.publicKey,
        config: configPda,
        agent: agent.publicKey,
        reputation: reputationPda,
      })
      .signers([platformAuthority])
      .rpc();

    reputationAccount = await program.account.reputationAccount.fetch(
      reputationPda,
    );
    expect(reputationAccount.score.toNumber()).to.equal(0);
    expect(reputationAccount.eventsCount).to.equal(4);
  });
});
