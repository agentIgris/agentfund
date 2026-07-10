/**
 * tests/pda.test.ts — unit tests for the PDA derivation helpers in
 * src/services/solana.ts, asserting they match manual
 * PublicKey.findProgramAddressSync computations using the exact seeds
 * from @agentfund/shared's PDA_SEEDS (the same literal seeds the Rust
 * programs use).
 *
 * config.ts reads REGISTRY_PROGRAM_ID / ESCROW_PROGRAM_ID /
 * REPUTATION_PROGRAM_ID from process.env at module-load time, so the
 * env vars below are set *before* dynamically importing solana.ts (a
 * static top-level import would be hoisted ahead of these assignments).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { PDA_SEEDS } from "@agentfund/shared";

const registryProgramId = Keypair.generate().publicKey;
const escrowProgramId = Keypair.generate().publicKey;
const reputationProgramId = Keypair.generate().publicKey;

process.env.REGISTRY_PROGRAM_ID = registryProgramId.toBase58();
process.env.ESCROW_PROGRAM_ID = escrowProgramId.toBase58();
process.env.REPUTATION_PROGRAM_ID = reputationProgramId.toBase58();

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let solana: typeof import("../src/services/solana.js");
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let encoding: typeof import("../src/services/anchorEncoding.js");

beforeAll(async () => {
  solana = await import("../src/services/solana.js");
  encoding = await import("../src/services/anchorEncoding.js");
});

describe("deriveAgentPda", () => {
  it("matches PDA_SEEDS.AGENT + owner under the registry program", () => {
    const owner = Keypair.generate().publicKey;
    const [expected, expectedBump] = PublicKey.findProgramAddressSync(
      [Buffer.from(PDA_SEEDS.AGENT), owner.toBuffer()],
      registryProgramId,
    );
    const [actual, actualBump] = solana.deriveAgentPda(owner);

    expect(actual.toBase58()).toBe(expected.toBase58());
    expect(actualBump).toBe(expectedBump);
  });
});

describe("deriveProjectPda", () => {
  it("matches PDA_SEEDS.PROJECT + creator + u32-LE project index under the registry program", () => {
    const creator = Keypair.generate().publicKey;
    const projectIndex = 7;
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from(PDA_SEEDS.PROJECT), creator.toBuffer(), encoding.encodeU32(projectIndex)],
      registryProgramId,
    );
    const [actual] = solana.deriveProjectPda(creator, projectIndex);

    expect(actual.toBase58()).toBe(expected.toBase58());
  });

  it("derives a different address for a different project index", () => {
    const creator = Keypair.generate().publicKey;
    const [first] = solana.deriveProjectPda(creator, 0);
    const [second] = solana.deriveProjectPda(creator, 1);

    expect(first.toBase58()).not.toBe(second.toBase58());
  });
});

describe("deriveEscrowPda", () => {
  it("matches PDA_SEEDS.ESCROW + project under the escrow program", () => {
    const project = Keypair.generate().publicKey;
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from(PDA_SEEDS.ESCROW), project.toBuffer()],
      escrowProgramId,
    );
    const [actual] = solana.deriveEscrowPda(project);

    expect(actual.toBase58()).toBe(expected.toBase58());
  });
});

describe("deriveContributionPda", () => {
  it("matches PDA_SEEDS.CONTRIBUTION + project + contributor under the escrow program", () => {
    const project = Keypair.generate().publicKey;
    const contributor = Keypair.generate().publicKey;
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from(PDA_SEEDS.CONTRIBUTION), project.toBuffer(), contributor.toBuffer()],
      escrowProgramId,
    );
    const [actual] = solana.deriveContributionPda(project, contributor);

    expect(actual.toBase58()).toBe(expected.toBase58());
  });
});

describe("deriveVotePda", () => {
  it("matches PDA_SEEDS.VOTE + project + voter + u8 milestone index under the escrow program", () => {
    const project = Keypair.generate().publicKey;
    const voter = Keypair.generate().publicKey;
    const milestoneIndex = 3;
    const [expected] = PublicKey.findProgramAddressSync(
      [
        Buffer.from(PDA_SEEDS.VOTE),
        project.toBuffer(),
        voter.toBuffer(),
        encoding.encodeU8(milestoneIndex),
      ],
      escrowProgramId,
    );
    const [actual] = solana.deriveVotePda(project, voter, milestoneIndex);

    expect(actual.toBase58()).toBe(expected.toBase58());
  });

  it("derives a different address for a different milestone index", () => {
    const project = Keypair.generate().publicKey;
    const voter = Keypair.generate().publicKey;
    const [first] = solana.deriveVotePda(project, voter, 0);
    const [second] = solana.deriveVotePda(project, voter, 1);

    expect(first.toBase58()).not.toBe(second.toBase58());
  });
});

describe("deriveReputationPda", () => {
  it("matches PDA_SEEDS.REPUTATION + agent under the reputation program", () => {
    const agent = Keypair.generate().publicKey;
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from(PDA_SEEDS.REPUTATION), agent.toBuffer()],
      reputationProgramId,
    );
    const [actual] = solana.deriveReputationPda(agent);

    expect(actual.toBase58()).toBe(expected.toBase58());
  });
});
