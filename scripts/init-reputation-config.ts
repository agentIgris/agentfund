/**
 * init-reputation-config.ts — one-time (per cluster) initialization of the
 * reputation program's Config PDA, storing the platform authority pubkey
 * that every subsequent `update_reputation` must be signed by (see
 * programs/reputation/src/lib.rs `Initialize` / `has_one = authority`,
 * and api/src/services/reputationWriter.ts for the runtime write path).
 *
 * Run (any cluster):
 *
 *   SOLANA_RPC_URL=http://127.0.0.1:8899 \
 *   REPUTATION_PROGRAM_ID=7DVKSmmhKVWW5JpwWCS89Fi6uwj3RaPADEBbVqyH8Zo7 \
 *   REPUTATION_AUTHORITY_SECRET="$(cat ~/.config/solana/id.json)" \
 *   npx tsx scripts/init-reputation-config.ts
 *
 * The authority keypair is also the fee/rent payer. A second run against
 * the same cluster fails with Anchor's "already in use" (Config uses
 * `init`) — that is expected and reported as such.
 */
import { Connection, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  buildInitializeReputationConfigIx,
  deriveReputationConfigPda,
} from "../api/src/services/reputationIx.js";

async function main(): Promise<void> {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
  const secret = process.env.REPUTATION_AUTHORITY_SECRET;
  if (!secret) {
    throw new Error("REPUTATION_AUTHORITY_SECRET is required (JSON byte array, like solana-keygen's id.json)");
  }
  const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret) as number[]));
  const conn = new Connection(rpcUrl, "confirmed");

  const [configPda] = deriveReputationConfigPda();
  console.log(`cluster:    ${rpcUrl}`);
  console.log(`authority:  ${authority.publicKey.toBase58()}`);
  console.log(`config PDA: ${configPda.toBase58()}`);

  const existing = await conn.getAccountInfo(configPda);
  if (existing) {
    console.log("Config PDA already initialized — nothing to do.");
    return;
  }

  const ix = buildInitializeReputationConfigIx({
    payer: authority.publicKey,
    authority: authority.publicKey,
  });
  const tx = new Transaction().add(ix);
  tx.feePayer = authority.publicKey;
  const signature = await sendAndConfirmTransaction(conn, tx, [authority], {
    commitment: "confirmed",
  });
  console.log(`initialized: ${signature}`);
}

main().catch((err) => {
  console.error("fatal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
