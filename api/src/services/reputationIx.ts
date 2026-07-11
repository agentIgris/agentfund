/**
 * services/reputationIx.ts — instruction builders + PDA derivation for the
 * `reputation` on-chain program (programs/reputation/src/lib.rs), following
 * the same hand-rolled Anchor sighash + Borsh encoding style as
 * services/solana.ts (see services/anchorEncoding.ts for the primitives).
 *
 * Unlike solana.ts's builders — which return unsigned instructions handed
 * back to the *requesting agent* to sign via `/tx/build` + `/tx/send` — every
 * instruction built here is meant to be signed by the platform authority
 * keypair (services/reputationWriter.ts). These are platform-driven writes,
 * never exposed through the public `/tx/build/:action` route.
 */
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { config } from "../config.js";
import {
  buildInstructionData,
  encodeI64,
  encodePubkey,
  encodeU8,
} from "./anchorEncoding.js";
import { deriveReputationPda } from "./solana.js";

export { deriveReputationPda };

function reputationProgramId(): PublicKey {
  const raw = config.solana.reputationProgramId;
  if (!raw) {
    throw new Error(
      "REPUTATION_PROGRAM_ID is not configured — set it in .env before building reputation transactions",
    );
  }
  return new PublicKey(raw);
}

// ─────────────────────────────────────────────────────────────
// PDA derivation
// ─────────────────────────────────────────────────────────────

// CONFIG_SEED is program-local (programs/reputation/src/lib.rs:49,
// `pub const CONFIG_SEED: &[u8] = b"config";`) and, per that file's own
// comment (lib.rs:44-46), intentionally NOT duplicated into
// @agentfund/shared's PDA_SEEDS — only cross-program seeds live there.
// deriveReputationPda (seeds = ["reputation", agent], lib.rs:50/171/196)
// already lives in services/solana.ts and is re-exported above.
const CONFIG_SEED = "config";

/** Config PDA — seeds = ["config"] (lib.rs:148-150). Holds the platform authority pubkey. */
export function deriveReputationConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from(CONFIG_SEED)], reputationProgramId());
}

// ─────────────────────────────────────────────────────────────
// Point table — mirrors programs/reputation/src/lib.rs:233-273
// (`ReputationReason` enum + `point_value()`). The program independently
// re-derives and enforces this same mapping on-chain (lib.rs:101-102,
// `DeltaReasonMismatch`), so any drift here can only ever fail CLOSED
// (the transaction is rejected) — it can never let a wrong delta land.
// ─────────────────────────────────────────────────────────────

export const REPUTATION_REASONS = {
  /** lib.rs:236-237 — +15, project milestone released. */
  MilestoneReleased: { code: 0, delta: 15 },
  /** lib.rs:238-239 — +5, contribution made to another agent's project. */
  ContributionMade: { code: 1, delta: 5 },
  /** lib.rs:240-241 — +2, governance vote cast. */
  VoteCast: { code: 2, delta: 2 },
  /** lib.rs:242-243 — +50, project goal fully reached. */
  GoalReached: { code: 3, delta: 50 },
  /** lib.rs:244-245 — -20, project refunded (failed). */
  ProjectRefunded: { code: 4, delta: -20 },
  /** lib.rs:246-247 — -50, project flagged as fraudulent. */
  ProjectFlaggedFraudulent: { code: 5, delta: -50 },
} as const satisfies Record<string, { code: number; delta: number }>;

export type ReputationReasonName = keyof typeof REPUTATION_REASONS;

// ─────────────────────────────────────────────────────────────
// Instruction builders — account ordering follows the exact
// `#[derive(Accounts)]` structs in programs/reputation/src/lib.rs.
// ─────────────────────────────────────────────────────────────

export interface InitializeReputationConfigParams {
  /** Pays the Config PDA's rent. Must sign. */
  payer: PublicKey;
  /** Platform authority pubkey stored on Config — the only signer `update_reputation` will accept afterward. */
  authority: PublicKey;
}

/**
 * `initialize(authority: Pubkey)` (lib.rs:63-68). Accounts per `Initialize`
 * (lib.rs:139-154): [payer (signer, mut), config (PDA, init, mut),
 * system_program]. Callable once per cluster — a second call fails with
 * Anchor's "already in use" since `config` uses `init`.
 */
export function buildInitializeReputationConfigIx(
  params: InitializeReputationConfigParams,
): TransactionInstruction {
  const [configPda] = deriveReputationConfigPda();
  return new TransactionInstruction({
    programId: reputationProgramId(),
    keys: [
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buildInstructionData("initialize", [encodePubkey(params.authority)]),
  });
}

export interface InitReputationParams {
  /** Pays the ReputationAccount PDA's rent — the platform authority wallet in practice, but the instruction itself is permissionless. */
  payer: PublicKey;
  /** Agent wallet the score account belongs to. Does NOT sign (lib.rs:161-165: `init_reputation` is intentionally permissionless). */
  agent: PublicKey;
}

/**
 * `init_reputation()` (lib.rs:74-91). Accounts per `InitReputation`
 * (lib.rs:156-177): [payer (signer, mut), agent (unchecked, not a signer),
 * reputation (PDA, init, mut), system_program].
 */
export function buildInitReputationIx(params: InitReputationParams): TransactionInstruction {
  const [reputation] = deriveReputationPda(params.agent);
  return new TransactionInstruction({
    programId: reputationProgramId(),
    keys: [
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: params.agent, isSigner: false, isWritable: false },
      { pubkey: reputation, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buildInstructionData("init_reputation", []),
  });
}

export interface UpdateReputationParams {
  /** Platform authority wallet — must match Config.authority (lib.rs:186, `has_one = authority`). Must sign. */
  authority: PublicKey;
  /** Agent wallet whose score is being updated. Does NOT sign — only used to derive the ReputationAccount PDA seed (lib.rs:190-192). */
  agent: PublicKey;
  /**
   * Reason code driving both the on-chain `reason: u8` arg and the
   * `delta: i64` arg. Deliberately not a free-standing `delta` parameter:
   * the program requires `delta === point_value(reason)` exactly
   * (lib.rs:101-102) and rejects any mismatch, so deriving both from
   * REPUTATION_REASONS here makes an inconsistent call unrepresentable
   * rather than merely rejected on-chain.
   */
  reason: ReputationReasonName;
}

/**
 * `update_reputation(delta: i64, reason: u8)` (lib.rs:100-132). Accounts
 * per `UpdateReputation` (lib.rs:179-200): [authority (signer), config
 * (PDA, read-only, `has_one = authority`), agent (unchecked, not a
 * signer), reputation (PDA, mut)].
 */
export function buildUpdateReputationIx(params: UpdateReputationParams): TransactionInstruction {
  const [configPda] = deriveReputationConfigPda();
  const [reputation] = deriveReputationPda(params.agent);
  const { code, delta } = REPUTATION_REASONS[params.reason];

  return new TransactionInstruction({
    programId: reputationProgramId(),
    keys: [
      { pubkey: params.authority, isSigner: true, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: params.agent, isSigner: false, isWritable: false },
      { pubkey: reputation, isSigner: false, isWritable: true },
    ],
    data: buildInstructionData("update_reputation", [encodeI64(delta), encodeU8(code)]),
  });
}
