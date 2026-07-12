/**
 * services/solana.ts — Connection + (lightweight) Anchor provider, PDA
 * derivation, and unsigned-instruction builders for the three on-chain
 * programs (agent_registry, escrow, reputation). See
 * services/anchorEncoding.ts for the Borsh/discriminator primitives this
 * module composes.
 *
 * PDA seeds are imported from @agentfund/shared's PDA_SEEDS so they can
 * never drift from the Rust programs (each program's src/lib.rs), which
 * import the same literal seed strings.
 */
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Keypair,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { NATIVE_SOL_MINT, PDA_SEEDS } from "@agentfund/shared";
import { config } from "../config.js";
import {
  buildInstructionData,
  encodeBool,
  encodeI64,
  encodePubkey,
  encodeString,
  encodeU32,
  encodeU64,
  encodeU8,
} from "./anchorEncoding.js";

// ─────────────────────────────────────────────────────────────
// Connection / Anchor provider
// ─────────────────────────────────────────────────────────────

let connection: Connection | undefined;

/** Process-wide Connection, built from SOLANA_RPC_URL (cluster-agnostic). */
export function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(config.solana.rpcUrl, "confirmed");
  }
  return connection;
}

/**
 * Read-only Anchor provider (dummy wallet — never signs). Only useful
 * for `Program`-less raw account fetches via the underlying Connection;
 * every instruction this API builds is unsigned and handed back to the
 * requesting agent, which signs locally with its own keypair (per the
 * spec's `/tx/build` + `/tx/send` pattern — the API itself never holds
 * agent private keys).
 */
export function getAnchorProvider(): anchor.AnchorProvider {
  const dummyWallet: anchor.Wallet = {
    publicKey: PublicKey.default,
    // eslint-disable-next-line @typescript-eslint/require-await
    signTransaction: async <T>(tx: T): Promise<T> => tx,
    // eslint-disable-next-line @typescript-eslint/require-await
    signAllTransactions: async <T>(txs: T[]): Promise<T[]> => txs,
    payer: undefined as unknown as Keypair,
  };
  return new anchor.AnchorProvider(getConnection(), dummyWallet, {
    commitment: "confirmed",
  });
}

// ─────────────────────────────────────────────────────────────
// Well-known SPL program ids (avoids pulling in @solana/spl-token just
// for these two constants + the ATA derivation formula).
// ─────────────────────────────────────────────────────────────

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

export function isNativeSol(tokenMint: string | PublicKey): boolean {
  const mint = typeof tokenMint === "string" ? tokenMint : tokenMint.toBase58();
  return mint === NATIVE_SOL_MINT;
}

export function getAssociatedTokenAddress(mint: PublicKey, owner: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

function programId(name: "registry" | "escrow" | "reputation"): PublicKey {
  const raw =
    name === "registry"
      ? config.solana.registryProgramId
      : name === "escrow"
        ? config.solana.escrowProgramId
        : config.solana.reputationProgramId;
  if (!raw) {
    throw new Error(
      `${name.toUpperCase()}_PROGRAM_ID is not configured — set it in .env before building transactions`,
    );
  }
  return new PublicKey(raw);
}

// ─────────────────────────────────────────────────────────────
// PDA derivation — must match programs/*/src/lib.rs `seeds = [...]`
// byte-for-byte.
// ─────────────────────────────────────────────────────────────

export function deriveConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from(PDA_SEEDS.CONFIG)], programId("registry"));
}

export function deriveAgentPda(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.AGENT), owner.toBuffer()],
    programId("registry"),
  );
}

export function deriveProjectPda(creator: PublicKey, projectIndex: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.PROJECT), creator.toBuffer(), encodeU32(projectIndex)],
    programId("registry"),
  );
}

export function deriveEscrowPda(project: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.ESCROW), project.toBuffer()],
    programId("escrow"),
  );
}

export function deriveContributionPda(project: PublicKey, contributor: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.CONTRIBUTION), project.toBuffer(), contributor.toBuffer()],
    programId("escrow"),
  );
}

export function deriveVotePda(
  project: PublicKey,
  voter: PublicKey,
  milestoneIndex: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(PDA_SEEDS.VOTE),
      project.toBuffer(),
      voter.toBuffer(),
      encodeU8(milestoneIndex),
    ],
    programId("escrow"),
  );
}

export function deriveReputationPda(agent: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.REPUTATION), agent.toBuffer()],
    programId("reputation"),
  );
}

// ─────────────────────────────────────────────────────────────
// Instruction builders
//
// Account ordering and Option<Account> placeholder handling follow the
// exact `#[derive(Accounts)]` structs in programs/*/src/lib.rs. Anchor's
// optional-account convention: when a client wants to pass `None` for an
// `Option<AccountInfo>` field, it supplies the invoked program's own id
// as a placeholder pubkey instead of omitting the account; the program
// resolves that as `None`. We replicate this by hand since no generated
// IDL/Program client is used here (see anchorEncoding.ts doc comment).
// ─────────────────────────────────────────────────────────────

/**
 * One-time platform setup: creates the Config PDA and records
 * `authority` as the platform-wide address permitted (alongside a
 * project's own creator) to call `update_project_status` /
 * `update_project_metadata`. Anchor's `init` constraint on `config`
 * rejects a second call — safe to attempt unconditionally.
 */
export interface InitializeParams {
  /** Pays the Config account's rent; need not be `authority` itself. */
  payer: PublicKey;
  authority: PublicKey;
}

export function buildInitializeIx(params: InitializeParams): TransactionInstruction {
  const [config] = deriveConfigPda();
  return new TransactionInstruction({
    programId: programId("registry"),
    keys: [
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buildInstructionData("initialize", [encodePubkey(params.authority)]),
  });
}

export interface RegisterAgentParams {
  owner: PublicKey;
  metadataUri: string;
}

export function buildRegisterAgentIx(params: RegisterAgentParams): TransactionInstruction {
  const [agent] = deriveAgentPda(params.owner);
  return new TransactionInstruction({
    programId: programId("registry"),
    keys: [
      { pubkey: params.owner, isSigner: true, isWritable: true },
      { pubkey: agent, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buildInstructionData("register_agent", [encodeString(params.metadataUri)]),
  });
}

export interface CreateProjectParams {
  creator: PublicKey;
  /** Current on-chain AgentAccount.projects_created snapshot (the API resolves this from its indexed DB). */
  projectIndex: number;
  ipfsHash: string;
  goalAmount: bigint | number;
  tokenMint: PublicKey;
  /** Unix seconds. */
  deadline: bigint | number;
  milestoneCount: number;
}

export function buildCreateProjectIx(params: CreateProjectParams): TransactionInstruction {
  const [agent] = deriveAgentPda(params.creator);
  const [project] = deriveProjectPda(params.creator, params.projectIndex);
  return new TransactionInstruction({
    programId: programId("registry"),
    keys: [
      { pubkey: params.creator, isSigner: true, isWritable: true },
      { pubkey: agent, isSigner: false, isWritable: true },
      { pubkey: project, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buildInstructionData("create_project", [
      encodeString(params.ipfsHash),
      encodeU64(params.goalAmount),
      encodePubkey(params.tokenMint),
      encodeI64(params.deadline),
      encodeU8(params.milestoneCount),
    ]),
  });
}

export interface InitializeEscrowParams {
  /** Pays the escrow account rent (usually the creator itself). */
  payer: PublicKey;
  /** Bound into escrow.creator — the only address milestone releases pay. Must sign. */
  creator: PublicKey;
  project: PublicKey;
  goalAmount: bigint | number;
  /** Unix seconds. */
  deadline: bigint | number;
  milestoneCount: number;
  tokenMint: PublicKey;
}

export function buildInitializeEscrowIx(params: InitializeEscrowParams): TransactionInstruction {
  const [escrow] = deriveEscrowPda(params.project);
  const escrowProgram = programId("escrow");
  const native = isNativeSol(params.tokenMint);

  const mint = native ? escrowProgram : params.tokenMint;
  const escrowAta = native ? escrowProgram : getAssociatedTokenAddress(params.tokenMint, escrow);

  return new TransactionInstruction({
    programId: escrowProgram,
    keys: [
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: params.creator, isSigner: true, isWritable: false },
      { pubkey: escrow, isSigner: false, isWritable: true },
      // The registry ProjectAccount IS the project pubkey — the program
      // verifies its owner/discriminator and that every escrow term matches
      // the registered project (finding #3, on-chain binding).
      { pubkey: params.project, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: escrowAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buildInstructionData("initialize_escrow", [
      encodePubkey(params.project),
      encodeU64(params.goalAmount),
      encodeI64(params.deadline),
      encodeU8(params.milestoneCount),
      encodePubkey(params.tokenMint),
    ]),
  });
}

export interface ContributeParams {
  contributor: PublicKey;
  project: PublicKey;
  tokenMint: PublicKey;
  amount: bigint | number;
}

export function buildContributeIx(params: ContributeParams): TransactionInstruction {
  const [escrow] = deriveEscrowPda(params.project);
  const [contribution] = deriveContributionPda(params.project, params.contributor);
  const escrowProgram = programId("escrow");
  const native = isNativeSol(params.tokenMint);

  const contributorAta = native
    ? escrowProgram
    : getAssociatedTokenAddress(params.tokenMint, params.contributor);
  const escrowAta = native ? escrowProgram : getAssociatedTokenAddress(params.tokenMint, escrow);

  return new TransactionInstruction({
    programId: escrowProgram,
    keys: [
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: contribution, isSigner: false, isWritable: true },
      { pubkey: params.contributor, isSigner: true, isWritable: true },
      { pubkey: contributorAta, isSigner: false, isWritable: true },
      { pubkey: escrowAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buildInstructionData("contribute", [
      encodePubkey(params.project),
      encodeU64(params.amount),
    ]),
  });
}

export interface ContributeForParams {
  /** Funds source + rent payer (e.g. the x402 facilitator / platform treasury). */
  payer: PublicKey;
  /** Wallet credited with the contribution (vote weight, refund rights). */
  beneficiary: PublicKey;
  project: PublicKey;
  tokenMint: PublicKey;
  amount: bigint | number;
}

export function buildContributeForIx(params: ContributeForParams): TransactionInstruction {
  const [escrow] = deriveEscrowPda(params.project);
  const [contribution] = deriveContributionPda(params.project, params.beneficiary);
  const escrowProgram = programId("escrow");
  const native = isNativeSol(params.tokenMint);

  const payerAta = native
    ? escrowProgram
    : getAssociatedTokenAddress(params.tokenMint, params.payer);
  const escrowAta = native ? escrowProgram : getAssociatedTokenAddress(params.tokenMint, escrow);

  return new TransactionInstruction({
    programId: escrowProgram,
    keys: [
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: contribution, isSigner: false, isWritable: true },
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: params.beneficiary, isSigner: false, isWritable: false },
      { pubkey: payerAta, isSigner: false, isWritable: true },
      { pubkey: escrowAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buildInstructionData("contribute_for", [
      encodePubkey(params.project),
      encodeU64(params.amount),
    ]),
  });
}

export interface VoteMilestoneParams {
  voter: PublicKey;
  project: PublicKey;
  milestoneIndex: number;
  support: boolean;
}

export function buildVoteMilestoneIx(params: VoteMilestoneParams): TransactionInstruction {
  const [escrow] = deriveEscrowPda(params.project);
  const [contribution] = deriveContributionPda(params.project, params.voter);
  const [voteAccount] = deriveVotePda(params.project, params.voter, params.milestoneIndex);

  return new TransactionInstruction({
    programId: programId("escrow"),
    keys: [
      { pubkey: escrow, isSigner: false, isWritable: false },
      { pubkey: contribution, isSigner: false, isWritable: false },
      { pubkey: voteAccount, isSigner: false, isWritable: true },
      { pubkey: params.voter, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buildInstructionData("vote_milestone", [
      encodePubkey(params.project),
      encodeU8(params.milestoneIndex),
      encodeBool(params.support),
    ]),
  });
}

export interface ReleaseMilestoneParams {
  /** Fee-payer/crank caller — need not be the project creator (permissionless once vote threshold holds). */
  payer: PublicKey;
  project: PublicKey;
  creator: PublicKey;
  tokenMint: PublicKey;
  milestoneIndex: number;
  /** VoteAccount PDAs tallied on-chain via remaining_accounts. */
  voteAccounts?: PublicKey[];
}

export function buildReleaseMilestoneIx(params: ReleaseMilestoneParams): TransactionInstruction {
  const [escrow] = deriveEscrowPda(params.project);
  const escrowProgram = programId("escrow");
  const native = isNativeSol(params.tokenMint);

  const escrowAta = native ? escrowProgram : getAssociatedTokenAddress(params.tokenMint, escrow);
  const creatorAta = native
    ? escrowProgram
    : getAssociatedTokenAddress(params.tokenMint, params.creator);

  const keys = [
    { pubkey: escrow, isSigner: false, isWritable: true },
    { pubkey: params.creator, isSigner: false, isWritable: true },
    { pubkey: escrowAta, isSigner: false, isWritable: true },
    { pubkey: creatorAta, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ...(params.voteAccounts ?? []).map((v) => ({ pubkey: v, isSigner: false, isWritable: false })),
  ];

  return new TransactionInstruction({
    programId: escrowProgram,
    keys,
    data: buildInstructionData("release_milestone", [
      encodePubkey(params.project),
      encodeU8(params.milestoneIndex),
    ]),
  });
}

/**
 * Replaces a project's on-chain `ipfs_hash`. Signer must be either the
 * project's own creator or the Config PDA's `authority` — the program
 * enforces this itself; this builder just assembles the accounts in the
 * exact order `UpdateProjectMetadata` expects (see programs/agent_registry/
 * src/lib.rs). The Config PDA must already exist (see `buildInitializeIx`)
 * since it's a plain `Account<'info, Config>`, not `init` here.
 */
export interface UpdateProjectMetadataParams {
  /** Either the project's creator or the platform authority — must sign. */
  authority: PublicKey;
  project: PublicKey;
  newIpfsHash: string;
}

export function buildUpdateProjectMetadataIx(
  params: UpdateProjectMetadataParams,
): TransactionInstruction {
  const [config] = deriveConfigPda();
  return new TransactionInstruction({
    programId: programId("registry"),
    keys: [
      { pubkey: params.authority, isSigner: true, isWritable: false },
      { pubkey: params.project, isSigner: false, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
    ],
    data: buildInstructionData("update_project_metadata", [encodeString(params.newIpfsHash)]),
  });
}

export interface RefundParams {
  contributor: PublicKey;
  project: PublicKey;
  tokenMint: PublicKey;
}

export function buildRefundIx(params: RefundParams): TransactionInstruction {
  const [escrow] = deriveEscrowPda(params.project);
  const [contribution] = deriveContributionPda(params.project, params.contributor);
  const escrowProgram = programId("escrow");
  const native = isNativeSol(params.tokenMint);

  const escrowAta = native ? escrowProgram : getAssociatedTokenAddress(params.tokenMint, escrow);
  const contributorAta = native
    ? escrowProgram
    : getAssociatedTokenAddress(params.tokenMint, params.contributor);

  return new TransactionInstruction({
    programId: escrowProgram,
    keys: [
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: contribution, isSigner: false, isWritable: true },
      { pubkey: params.contributor, isSigner: true, isWritable: true },
      { pubkey: escrowAta, isSigner: false, isWritable: true },
      { pubkey: contributorAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: buildInstructionData("refund", [encodePubkey(params.project)]),
  });
}

// ─────────────────────────────────────────────────────────────
// Transaction assembly
// ─────────────────────────────────────────────────────────────

/** Builds an unsigned Transaction with feePayer + a fresh blockhash, base64-encoded per TxBuildResponse. */
export async function buildUnsignedTransactionBase64(
  instructions: TransactionInstruction[],
  feePayer: PublicKey,
): Promise<string> {
  const conn = getConnection();
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    feePayer,
    blockhash,
    lastValidBlockHeight,
  });
  tx.add(...instructions);
  return tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
}
