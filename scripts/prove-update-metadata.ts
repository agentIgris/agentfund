/**
 * prove-update-metadata.ts — live proof of `agent_registry`'s new
 * `update_project_metadata` instruction against a LIVE validator, using
 * the same instruction builders the API would serve
 * (api/src/services/solana.ts). Written instead of relying on
 * `anchor test`/ts-mocha because IDL generation is blocked on this
 * toolchain (see LOCAL_VALIDATOR.md) — same convention as
 * scripts/prove-escrow-flow.ts.
 *
 * Run (WSL, local validator on :8899 with agent_registry loaded at
 * genesis — see LOCAL_VALIDATOR.md's SBPF workaround):
 *
 *   REGISTRY_PROGRAM_ID=2TqDeKaadPUeBcgaXXqYAqddfZngUfbq4m8iDSyePSBA \
 *   npx tsx scripts/prove-update-metadata.ts
 *
 * Proves, in order:
 *   1. `initialize` sets up the Config PDA (platform authority = a fresh
 *      test keypair, NOT the real devnet deploy wallet).
 *   2. The project's own creator can call update_project_metadata.
 *   3. The Config PDA's platform authority can also call it.
 *   4. An outsider (neither creator nor platform authority) is rejected
 *      with Unauthorized.
 *   5. A hash longer than MAX_IPFS_HASH_LEN (128) is rejected with
 *      IpfsHashTooLong.
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
  buildCreateProjectIx,
  buildInitializeIx,
  buildRegisterAgentIx,
  buildUpdateProjectMetadataIx,
  deriveProjectPda,
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

async function airdrop(pubkey: PublicKey, sol: number): Promise<void> {
  const sig = await conn.requestAirdrop(pubkey, sol * SOL);
  const bh = await conn.getLatestBlockhash("confirmed");
  await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
}

async function fetchIpfsHash(project: PublicKey): Promise<string> {
  const info = await conn.getAccountInfo(project, "confirmed");
  if (!info) throw new Error("project account not found");
  // Layout: 8-byte discriminator, creator (32), then ipfs_hash immediately
  // (Borsh String = u32 len prefix + utf8 bytes) — project_index comes much
  // later in the struct, not between creator and ipfs_hash.
  const offset = 8 + 32;
  const len = info.data.readUInt32LE(offset);
  return info.data.toString("utf8", offset + 4, offset + 4 + len);
}

async function main(): Promise<void> {
  console.log(`\nAgentFund update_project_metadata live proof — RPC ${RPC}`);
  console.log(`agent_registry program: ${process.env.REGISTRY_PROGRAM_ID}`);

  const platformAuthority = Keypair.generate();
  const creator = Keypair.generate();
  const outsider = Keypair.generate();

  console.log(`\nplatformAuthority ${platformAuthority.publicKey.toBase58()}`);
  console.log(`creator           ${creator.publicKey.toBase58()}`);
  console.log(`outsider          ${outsider.publicKey.toBase58()}`);

  console.log("\n[setup] airdropping 5 SOL to each wallet…");
  await Promise.all([
    airdrop(platformAuthority.publicKey, 5),
    airdrop(creator.publicKey, 5),
    airdrop(outsider.publicKey, 5),
  ]);

  // ── initialize the Config PDA ────────────────────────────────
  await sendTx(
    [buildInitializeIx({ payer: creator.publicKey, authority: platformAuthority.publicKey })],
    creator,
  );
  pass("initialize", `Config.authority = ${platformAuthority.publicKey.toBase58().slice(0, 8)}…`);

  // ── register + create a project to update metadata on ───────
  await sendTx([buildRegisterAgentIx({ owner: creator.publicKey, metadataUri: "ipfs://proof-agent" })], creator);
  pass("register_agent");

  const [project] = deriveProjectPda(creator.publicKey, 0);
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  await sendTx(
    [
      buildCreateProjectIx({
        creator: creator.publicKey,
        projectIndex: 0,
        ipfsHash: "placeholder-hash",
        goalAmount: 1 * SOL,
        tokenMint: NATIVE_MINT,
        deadline,
        milestoneCount: 1,
      }),
    ],
    creator,
  );
  pass("create_project", project.toBase58());

  // ── 1. creator succeeds ──────────────────────────────────────
  const hashV1 = "sha256:" + "1".repeat(64);
  await sendTx(
    [buildUpdateProjectMetadataIx({ authority: creator.publicKey, project, newIpfsHash: hashV1 })],
    creator,
  );
  const afterCreator = await fetchIpfsHash(project);
  if (afterCreator === hashV1) pass("update_project_metadata (creator)", hashV1);
  else fail("update_project_metadata (creator)", `expected ${hashV1}, got ${afterCreator}`);

  // ── 2. platform authority succeeds ───────────────────────────
  const hashV2 = "sha256:" + "2".repeat(64);
  await sendTx(
    [
      buildUpdateProjectMetadataIx({
        authority: platformAuthority.publicKey,
        project,
        newIpfsHash: hashV2,
      }),
    ],
    platformAuthority,
  );
  const afterPlatform = await fetchIpfsHash(project);
  if (afterPlatform === hashV2) pass("update_project_metadata (platform authority)", hashV2);
  else fail("update_project_metadata (platform authority)", `expected ${hashV2}, got ${afterPlatform}`);

  // ── 3. outsider rejected (Unauthorized) ──────────────────────
  await expectFail("update_project_metadata rejects outsider", ["Unauthorized"], () =>
    sendTx(
      [
        buildUpdateProjectMetadataIx({
          authority: outsider.publicKey,
          project,
          newIpfsHash: "sha256:attacker-controlled",
        }),
      ],
      outsider,
    ),
  );

  // ── 4. oversized hash rejected (IpfsHashTooLong) ─────────────
  await expectFail("update_project_metadata rejects oversized hash", ["IpfsHashTooLong"], () =>
    sendTx(
      [
        buildUpdateProjectMetadataIx({
          authority: creator.publicKey,
          project,
          newIpfsHash: "x".repeat(129),
        }),
      ],
      creator,
    ),
  );

  console.log(`\n${passCount} passed, ${failCount} failed.\n`);
  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
