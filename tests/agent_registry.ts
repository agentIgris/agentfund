/**
 * Anchor test suite for the `agent_registry` program.
 *
 * Covers:
 *  - register_agent (AgentAccount PDA creation)
 *  - create_project (ProjectAccount PDA creation, agent counter bump)
 *  - create_project rejecting a deadline that is not strictly in the future
 *  - update_project_status rejecting a signer who is neither the project's
 *    creator nor the platform authority stored in the Config PDA
 *  - update_project_metadata: creator succeeds, platform authority
 *    succeeds, outsider rejected (Unauthorized), over-length hash
 *    rejected (IpfsHashTooLong)
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

// Sentinel mint representing native SOL (matches shared/src/constants.ts
// NATIVE_SOL_MINT — duplicated here so this test file has no dependency
// on the @agentfund/shared workspace package).
const NATIVE_SOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112",
);

const CONFIG_SEED = Buffer.from("config");
const AGENT_SEED = Buffer.from("agent");
const PROJECT_SEED = Buffer.from("project");

function u32LeBytes(n: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(n, 0);
  return buf;
}

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

describe("agent_registry", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Untyped against the generated IDL types (target/types/agent_registry
  // is produced by `anchor build`, which this workspace does not run) —
  // `program.methods` / `program.account` still resolve dynamically from
  // the loaded IDL at runtime.
  const program = anchor.workspace.AgentRegistry as Program;
  const connection = provider.connection;

  const platformAuthority = Keypair.generate();
  const creator = Keypair.generate();
  const outsider = Keypair.generate();

  const [configPda] = PublicKey.findProgramAddressSync(
    [CONFIG_SEED],
    program.programId,
  );
  const [agentPda] = PublicKey.findProgramAddressSync(
    [AGENT_SEED, creator.publicKey.toBuffer()],
    program.programId,
  );

  before(async () => {
    await airdrop(connection, creator.publicKey, 5);
    await airdrop(connection, outsider.publicKey, 2);

    // Platform Config PDA — authority is a distinct keypair from both
    // `creator` and `outsider` so the authorization tests are unambiguous.
    await program.methods
      .initialize(platformAuthority.publicKey)
      .accounts({
        payer: provider.wallet.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  it("registers an agent", async () => {
    const metadataUri = "https://ipfs.io/ipfs/QmAgentMetadataExample1234567890";

    await program.methods
      .registerAgent(metadataUri)
      .accounts({
        owner: creator.publicKey,
        agent: agentPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const agentAccount = await program.account.agentAccount.fetch(agentPda);
    expect(agentAccount.owner.toBase58()).to.equal(
      creator.publicKey.toBase58(),
    );
    expect(agentAccount.metadataUri).to.equal(metadataUri);
    expect(agentAccount.projectsCreated).to.equal(0);
    expect(agentAccount.reputationScore.toNumber()).to.equal(0);
    expect(agentAccount.totalContributed.toNumber()).to.equal(0);
  });

  it("creates a project and bumps the agent's project counter", async () => {
    const ipfsHash = "QmProjectIpfsHashExample1234567890abcdef";
    const goalAmount = new anchor.BN(2 * LAMPORTS_PER_SOL);
    const deadline = new anchor.BN(
      Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days out
    );
    const milestoneCount = 3;

    const [projectPda] = PublicKey.findProgramAddressSync(
      [PROJECT_SEED, creator.publicKey.toBuffer(), u32LeBytes(0)],
      program.programId,
    );

    await program.methods
      .createProject(ipfsHash, goalAmount, NATIVE_SOL_MINT, deadline, milestoneCount)
      .accounts({
        creator: creator.publicKey,
        agent: agentPda,
        project: projectPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const projectAccount = await program.account.projectAccount.fetch(
      projectPda,
    );
    expect(projectAccount.creator.toBase58()).to.equal(
      creator.publicKey.toBase58(),
    );
    expect(projectAccount.ipfsHash).to.equal(ipfsHash);
    expect(projectAccount.goalAmount.toString()).to.equal(
      goalAmount.toString(),
    );
    expect(projectAccount.tokenMint.toBase58()).to.equal(
      NATIVE_SOL_MINT.toBase58(),
    );
    expect(projectAccount.raisedAmount.toNumber()).to.equal(0);
    expect(projectAccount.milestoneCount).to.equal(milestoneCount);
    expect(projectAccount.projectIndex).to.equal(0);
    expect(projectAccount.status).to.deep.equal({ active: {} });

    const agentAccount = await program.account.agentAccount.fetch(agentPda);
    expect(agentAccount.projectsCreated).to.equal(1);
  });

  it("rejects create_project when the deadline is not in the future", async () => {
    const ipfsHash = "QmPastDeadlineProjectExample";
    const goalAmount = new anchor.BN(LAMPORTS_PER_SOL);
    const pastDeadline = new anchor.BN(Math.floor(Date.now() / 1000) - 3600);
    const milestoneCount = 1;

    // Next sequential index for `creator` — the prior test consumed index 0.
    const [projectPda] = PublicKey.findProgramAddressSync(
      [PROJECT_SEED, creator.publicKey.toBuffer(), u32LeBytes(1)],
      program.programId,
    );

    try {
      await program.methods
        .createProject(
          ipfsHash,
          goalAmount,
          NATIVE_SOL_MINT,
          pastDeadline,
          milestoneCount,
        )
        .accounts({
          creator: creator.publicKey,
          agent: agentPda,
          project: projectPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      expect.fail("expected create_project to reject a past deadline");
    } catch (err) {
      const anchorErr = err as AnchorError;
      expect(anchorErr.error?.errorCode?.code).to.equal("InvalidDeadline");
    }
  });

  it("rejects update_project_status from a signer who is neither the creator nor the platform authority", async () => {
    const [projectPda] = PublicKey.findProgramAddressSync(
      [PROJECT_SEED, creator.publicKey.toBuffer(), u32LeBytes(0)],
      program.programId,
    );

    try {
      await program.methods
        .updateProjectStatus({ funded: {} })
        .accounts({
          authority: outsider.publicKey,
          project: projectPda,
          config: configPda,
        })
        .signers([outsider])
        .rpc();
      expect.fail(
        "expected update_project_status to reject a non-creator, non-authority signer",
      );
    } catch (err) {
      const anchorErr = err as AnchorError;
      expect(anchorErr.error?.errorCode?.code).to.equal("Unauthorized");
    }
  });

  it("lets the creator update project metadata", async () => {
    const [projectPda] = PublicKey.findProgramAddressSync(
      [PROJECT_SEED, creator.publicKey.toBuffer(), u32LeBytes(0)],
      program.programId,
    );
    const newHash = "sha256:1111111111111111111111111111111111111111111111111111111111111111";

    await program.methods
      .updateProjectMetadata(newHash)
      .accounts({
        authority: creator.publicKey,
        project: projectPda,
        config: configPda,
      })
      .signers([creator])
      .rpc();

    const projectAccount = await program.account.projectAccount.fetch(
      projectPda,
    );
    expect(projectAccount.ipfsHash).to.equal(newHash);
  });

  it("lets the platform authority update project metadata", async () => {
    await airdrop(connection, platformAuthority.publicKey, 1);

    const [projectPda] = PublicKey.findProgramAddressSync(
      [PROJECT_SEED, creator.publicKey.toBuffer(), u32LeBytes(0)],
      program.programId,
    );
    const newHash = "sha256:2222222222222222222222222222222222222222222222222222222222222222";

    await program.methods
      .updateProjectMetadata(newHash)
      .accounts({
        authority: platformAuthority.publicKey,
        project: projectPda,
        config: configPda,
      })
      .signers([platformAuthority])
      .rpc();

    const projectAccount = await program.account.projectAccount.fetch(
      projectPda,
    );
    expect(projectAccount.ipfsHash).to.equal(newHash);
  });

  it("rejects update_project_metadata from a signer who is neither the creator nor the platform authority", async () => {
    const [projectPda] = PublicKey.findProgramAddressSync(
      [PROJECT_SEED, creator.publicKey.toBuffer(), u32LeBytes(0)],
      program.programId,
    );

    try {
      await program.methods
        .updateProjectMetadata("sha256:attacker-controlled-metadata")
        .accounts({
          authority: outsider.publicKey,
          project: projectPda,
          config: configPda,
        })
        .signers([outsider])
        .rpc();
      expect.fail(
        "expected update_project_metadata to reject a non-creator, non-authority signer",
      );
    } catch (err) {
      const anchorErr = err as AnchorError;
      expect(anchorErr.error?.errorCode?.code).to.equal("Unauthorized");
    }
  });

  it("rejects update_project_metadata when the new hash exceeds MAX_IPFS_HASH_LEN", async () => {
    const [projectPda] = PublicKey.findProgramAddressSync(
      [PROJECT_SEED, creator.publicKey.toBuffer(), u32LeBytes(0)],
      program.programId,
    );
    const oversized = "x".repeat(129); // MAX_IPFS_HASH_LEN is 128

    try {
      await program.methods
        .updateProjectMetadata(oversized)
        .accounts({
          authority: creator.publicKey,
          project: projectPda,
          config: configPda,
        })
        .signers([creator])
        .rpc();
      expect.fail(
        "expected update_project_metadata to reject an over-length hash",
      );
    } catch (err) {
      const anchorErr = err as AnchorError;
      expect(anchorErr.error?.errorCode?.code).to.equal("IpfsHashTooLong");
    }
  });
});
