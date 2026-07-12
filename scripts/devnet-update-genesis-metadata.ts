/**
 * devnet-update-genesis-metadata.ts — real DEVNET execution for Task A's
 * on-chain metadata fix, using the same instruction builders proven against
 * a local validator in scripts/prove-update-metadata.ts.
 *
 * Two steps, run separately so the `update` step can be deferred until the
 * new metadata URL (https://api.agentfund.online/metadata/genesis.json) is
 * actually live — the indexer's resolveMetadataJson() has no propagation-lag
 * fallback and fails loudly on a 404.
 *
 *   step init:
 *     - Idempotent. Calls `initialize` (Config PDA) with the deploy wallet
 *       as both payer and platform authority, IF the Config PDA doesn't
 *       already exist. Confirmed once via LOCAL_VALIDATOR.md's authority
 *       (DE6LQa1RRKHjwH8QvJ2SoACWejK36Yx6tronj7yD9dcE) — same wallet that
 *       is both the program's upgrade authority AND the genesis project's
 *       creator, so it will also satisfy update_project_metadata's
 *       is_creator check.
 *
 *   step update:
 *     - Calls `update_project_metadata` on the genesis ProjectAccount PDA
 *       with NEW_IPFS_HASH.
 *
 * Usage (WSL, real devnet):
 *   SOLANA_RPC_URL=https://api.devnet.solana.com \
 *   REGISTRY_PROGRAM_ID=2TqDeKaadPUeBcgaXXqYAqddfZngUfbq4m8iDSyePSBA \
 *   DEPLOY_WALLET_PATH=$HOME/.config/solana/id.json \
 *   npx tsx scripts/devnet-update-genesis-metadata.ts init
 *
 *   ... (after the metadata URL is confirmed live) ...
 *
 *   SOLANA_RPC_URL=https://api.devnet.solana.com \
 *   REGISTRY_PROGRAM_ID=2TqDeKaadPUeBcgaXXqYAqddfZngUfbq4m8iDSyePSBA \
 *   DEPLOY_WALLET_PATH=$HOME/.config/solana/id.json \
 *   NEW_IPFS_HASH="https://api.agentfund.online/metadata/genesis.json#sha256=<hex>" \
 *   npx tsx scripts/devnet-update-genesis-metadata.ts update
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  buildInitializeIx,
  buildUpdateProjectMetadataIx,
  deriveConfigPda,
} from "../api/src/services/solana.js";

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const conn = new Connection(RPC, "confirmed");
const GENESIS_PROJECT = new PublicKey("9RRsXtiCFu2RmGBcqcjosxek1QLjWVW8Z74hvJ6Bjh8H");

function loadWallet(): Keypair {
  const raw = process.env.DEPLOY_WALLET_PATH ?? path.join(os.homedir(), ".config/solana/id.json");
  const secret = JSON.parse(readFileSync(raw, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function main(): Promise<void> {
  const step = process.argv[2];
  if (step !== "init" && step !== "update") {
    console.error("usage: devnet-update-genesis-metadata.ts <init|update>");
    process.exit(2);
  }

  const wallet = loadWallet();
  console.log(`RPC: ${RPC}`);
  console.log(`wallet: ${wallet.publicKey.toBase58()}`);
  const balance = await conn.getBalance(wallet.publicKey, "confirmed");
  console.log(`balance: ${balance / 1e9} SOL`);

  const [configPda] = deriveConfigPda();
  console.log(`Config PDA: ${configPda.toBase58()}`);

  if (step === "init") {
    const existing = await conn.getAccountInfo(configPda, "confirmed");
    if (existing) {
      console.log("Config PDA already exists — skipping initialize (idempotent no-op).");
      // Sanity-check the authority still matches this wallet.
      const authorityBytes = existing.data.subarray(8, 40);
      const authority = new PublicKey(authorityBytes).toBase58();
      console.log(`  existing Config.authority = ${authority}`);
      if (authority !== wallet.publicKey.toBase58()) {
        console.error(
          `  WARNING: existing platform authority (${authority}) does not match ` +
            `this wallet (${wallet.publicKey.toBase58()}).`,
        );
      }
      return;
    }

    const ix = buildInitializeIx({ payer: wallet.publicKey, authority: wallet.publicKey });
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(conn, tx, [wallet], { commitment: "confirmed" });
    console.log(`initialize tx: ${sig}`);
    console.log(`https://explorer.solana.com/tx/${sig}?cluster=devnet`);
    return;
  }

  // step === "update"
  const newHash = process.env.NEW_IPFS_HASH;
  if (!newHash) {
    console.error("NEW_IPFS_HASH env var is required for the update step");
    process.exit(2);
  }

  const configInfo = await conn.getAccountInfo(configPda, "confirmed");
  if (!configInfo) {
    console.error("Config PDA does not exist yet — run the `init` step first.");
    process.exit(1);
  }

  const before = await conn.getAccountInfo(GENESIS_PROJECT, "confirmed");
  if (!before) {
    console.error("genesis project account not found");
    process.exit(1);
  }
  const beforeLen = before.data.readUInt32LE(40);
  const beforeHash = before.data.toString("utf8", 44, 44 + beforeLen);
  console.log(`before ipfs_hash: ${beforeHash}`);
  console.log(`new ipfs_hash:    ${newHash} (${newHash.length} chars)`);

  const ix = buildUpdateProjectMetadataIx({
    authority: wallet.publicKey,
    project: GENESIS_PROJECT,
    newIpfsHash: newHash,
  });
  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(conn, tx, [wallet], { commitment: "confirmed" });
  console.log(`update_project_metadata tx: ${sig}`);
  console.log(`https://explorer.solana.com/tx/${sig}?cluster=devnet`);

  const after = await conn.getAccountInfo(GENESIS_PROJECT, "confirmed");
  const afterLen = after!.data.readUInt32LE(40);
  const afterHash = after!.data.toString("utf8", 44, 44 + afterLen);
  console.log(`after ipfs_hash:  ${afterHash}`);
  if (afterHash !== newHash) {
    console.error("MISMATCH: on-chain hash after update does not equal the requested new hash!");
    process.exit(1);
  }
  console.log("verified: on-chain ipfs_hash now matches the requested value.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
