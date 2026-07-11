/**
 * tests/helius.test.ts — unit tests for the Helius webhook payload parser
 * in src/services/helius.ts. Guards the signature-extraction fix: raw
 * Helius deliveries carry the signature at transaction.signatures[0]
 * (NOT top-level), and falling back to "" once collapsed every live
 * event onto a single (signature="", eventName) dedup key — the second
 * live contribution was silently dropped (2026-07-12 incident; see
 * indexer.ts's IndexedEvent dedup).
 *
 * config.ts reads program IDs from process.env at module-load time, so
 * env vars are set before dynamically importing helius.ts (same pattern
 * as pda.test.ts).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";

const escrowProgramId = Keypair.generate().publicKey;
process.env.REGISTRY_PROGRAM_ID = Keypair.generate().publicKey.toBase58();
process.env.ESCROW_PROGRAM_ID = escrowProgramId.toBase58();
process.env.REPUTATION_PROGRAM_ID = Keypair.generate().publicKey.toBase58();

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let helius: typeof import("../src/services/helius.js");
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let encoding: typeof import("../src/services/anchorEncoding.js");

beforeAll(async () => {
  helius = await import("../src/services/helius.js");
  encoding = await import("../src/services/anchorEncoding.js");
});

const project = Keypair.generate().publicKey;
const contributor = Keypair.generate().publicKey;

/** Borsh-encodes a ContributionMade event exactly as programs/escrow's emit! logs it. */
function contributionMadeLogLine(): string {
  const buf = Buffer.alloc(8 + 32 + 32 + 8 + 8 + 8);
  let off = 0;
  encoding.anchorEventDiscriminator("ContributionMade").copy(buf, off);
  off += 8;
  project.toBuffer().copy(buf, off);
  off += 32;
  contributor.toBuffer().copy(buf, off);
  off += 32;
  buf.writeBigUInt64LE(5_000_000n, off); // amount
  off += 8;
  buf.writeBigUInt64LE(10_000_000n, off); // totalDeposited
  off += 8;
  buf.writeBigInt64LE(1_752_300_000n, off); // timestamp
  return `Program data: ${buf.toString("base64")}`;
}

function escrowLogs(): string[] {
  return [
    `Program ${escrowProgramId.toBase58()} invoke [1]`,
    contributionMadeLogLine(),
    `Program ${escrowProgramId.toBase58()} success`,
  ];
}

const SIG = "3Rvh1UMtT2TVk4uZtvd2D51T1zG62yao9A1SnhPT2KiEFD8KmCbFJvTsrvowZB3dph7xMfKVjUbTg9eaRMtfNtZT";

describe("parseTransactionLogs signature extraction", () => {
  it("uses the top-level signature when present (replay script shape)", () => {
    const events = helius.parseTransactionLogs({
      signature: SIG,
      slot: 475571912,
      meta: { logMessages: escrowLogs() },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.signature).toBe(SIG);
    expect(events[0]!.eventName).toBe("ContributionMade");
    expect(events[0]!.data).toMatchObject({
      project: project.toBase58(),
      contributor: contributor.toBase58(),
      amount: "5000000",
      totalDeposited: "10000000",
    });
  });

  it("falls back to transaction.signatures[0] (raw Helius delivery shape)", () => {
    const events = helius.parseTransactionLogs({
      slot: 475571912,
      meta: { logMessages: escrowLogs() },
      transaction: { signatures: [SIG, Keypair.generate().publicKey.toBase58()] },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.signature).toBe(SIG);
  });

  it("yields an empty signature when neither location has one (receiver refuses these)", () => {
    const events = helius.parseTransactionLogs({
      slot: 475571912,
      meta: { logMessages: escrowLogs() },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.signature).toBe("");
  });

  it("distinct raw-shape transactions keep distinct signatures (dedup key regression)", () => {
    const otherSig = "2io682CFt8jk2MGhm6maBAJh7LexFxeLEoCwmB3WtiehWJGyh9mpD3stMFuzj3xGZDQG2Z2GTPAhfvcFPYvZYy7L";
    const [a] = helius.parseTransactionLogs({
      meta: { logMessages: escrowLogs() },
      transaction: { signatures: [otherSig] },
    });
    const [b] = helius.parseTransactionLogs({
      meta: { logMessages: escrowLogs() },
      transaction: { signatures: [SIG] },
    });
    expect(a!.signature).not.toBe(b!.signature);
  });
});
