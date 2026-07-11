/**
 * services/reputationWriter.ts — the reputation WRITE path
 * (REVIEW_FINDINGS.md #10: "Reputation writes are dead"). Wired in from
 * services/indexer.ts at the points where a confirmed Contribution,
 * MilestoneReleased, or goal-reached event is persisted.
 *
 * Every call is fire-and-forget from the caller's perspective: this
 * module NEVER throws — a failure here (RPC hiccup, unconfigured
 * authority, unconfirmed tx) must never break event indexing, the
 * Contribution/Milestone write, or the Helius webhook response.
 *
 * Silently disabled — isReputationWriterEnabled() === false, logged once —
 * when REPUTATION_AUTHORITY_SECRET isn't set, so devs/CI without a platform
 * keypair configured see nothing break: reputation scores simply stay
 * frozen, exactly like before this change.
 */
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import { getConnection } from "./solana.js";
import {
  buildInitReputationIx,
  buildUpdateReputationIx,
  deriveReputationPda,
  type ReputationReasonName,
} from "./reputationIx.js";

// `undefined` = not parsed yet, `null` = unset or unparseable (disabled).
let cachedAuthority: Keypair | null | undefined;
let warnedDisabled = false;

function loadAuthorityKeypair(): Keypair | null {
  if (cachedAuthority !== undefined) return cachedAuthority;

  const raw = process.env.REPUTATION_AUTHORITY_SECRET;
  if (!raw) {
    cachedAuthority = null;
    return null;
  }
  try {
    const secretKey = Uint8Array.from(JSON.parse(raw) as number[]);
    cachedAuthority = Keypair.fromSecretKey(secretKey);
  } catch (err) {
    console.error(
      "reputationWriter: REPUTATION_AUTHORITY_SECRET is set but could not be parsed as a JSON byte array (like solana-keygen's id.json) — reputation writes disabled:",
      err instanceof Error ? err.message : err,
    );
    cachedAuthority = null;
  }
  return cachedAuthority;
}

/**
 * True once REPUTATION_AUTHORITY_SECRET is set and parses into a valid
 * keypair. Logs a one-time warning the first time it's found disabled.
 */
export function isReputationWriterEnabled(): boolean {
  const enabled = loadAuthorityKeypair() !== null;
  if (!enabled && !warnedDisabled) {
    warnedDisabled = true;
    console.warn(
      "reputationWriter: REPUTATION_AUTHORITY_SECRET not set — reputation scores will not be updated on-chain (expected in dev/CI; set it in production).",
    );
  }
  return enabled;
}

export interface ReputationEvent {
  /** Base58 wallet whose ReputationAccount PDA should be created/updated. */
  agentWallet: string;
  /** Reason key into REPUTATION_REASONS (services/reputationIx.ts) — determines both the on-chain delta and reason code. */
  reason: ReputationReasonName;
}

/** Checks whether an agent's ReputationAccount PDA has already been created. */
async function reputationAccountExists(connection: Connection, agent: PublicKey): Promise<boolean> {
  const [reputationPda] = deriveReputationPda(agent);
  const info = await connection.getAccountInfo(reputationPda);
  return info !== null;
}

/**
 * Applies one reputation event on-chain: `init_reputation` (only if the
 * agent's ReputationAccount PDA doesn't exist yet — idempotency check via
 * `connection.getAccountInfo`) followed by `update_reputation`, both in a
 * single transaction signed by the platform authority keypair (also the
 * fee payer). Never throws — errors are logged and swallowed so a flaky
 * RPC, an unconfigured authority, or an already-initialized account race
 * never breaks the caller.
 */
export async function applyReputationEvent(event: ReputationEvent): Promise<void> {
  const authority = loadAuthorityKeypair();
  if (!authority) {
    isReputationWriterEnabled(); // emits the one-time warn
    return;
  }

  try {
    const agent = new PublicKey(event.agentWallet);
    const connection = getConnection();

    const ixs = [];
    if (!(await reputationAccountExists(connection, agent))) {
      ixs.push(buildInitReputationIx({ payer: authority.publicKey, agent }));
    }
    ixs.push(
      buildUpdateReputationIx({ authority: authority.publicKey, agent, reason: event.reason }),
    );

    const tx = new Transaction().add(...ixs);
    tx.feePayer = authority.publicKey;
    await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });
  } catch (err) {
    console.error(
      `reputationWriter: failed to apply reputation event (reason=${event.reason}, agent=${event.agentWallet}):`,
      err instanceof Error ? err.message : err,
    );
  }
}
