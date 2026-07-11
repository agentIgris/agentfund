/**
 * smoke-x402-devnet.ts — LIVE devnet x402 smoke test against the production
 * API (https://api.agentfund.online). Donates real devnet USDC to the genesis
 * campaign via the full x402 flow (402 challenge -> sign -> X-PAYMENT -> receipt),
 * then confirms the tx on-chain and checks the indexer picked it up.
 *
 * Run (WSL): npx tsx scripts/smoke-x402-devnet.ts
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair } from "@solana/web3.js";
import { AgentFundClient } from "../sdk/src/client.js";

const API_URL = process.env.API_URL ?? "https://api.agentfund.online";
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const PROJECT_ID = "9RRsXtiCFu2RmGBcqcjosxek1QLjWVW8Z74hvJ6Bjh8H";
const AMOUNT = 5_000_000; // 5 USDC (6 decimals)

async function main(): Promise<void> {
  const keypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"))),
  );
  console.log(`donor:   ${keypair.publicKey.toBase58()}`);
  console.log(`api:     ${API_URL}`);
  console.log(`project: ${PROJECT_ID}`);
  console.log(`amount:  ${AMOUNT} base units (5 USDC)\n`);

  const client = new AgentFundClient({ apiUrl: API_URL, keypair });
  const t0 = Date.now();
  const { signature, receipt } = await client.donateViaX402({ projectId: PROJECT_ID, amount: AMOUNT });
  console.log(`SETTLED in ${Date.now() - t0}ms`);
  console.log(`signature: ${signature}`);
  console.log(`receipt:   ${JSON.stringify(receipt)}\n`);

  // On-chain confirmation
  const conn = new Connection(RPC, "confirmed");
  const tx = await conn.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
  if (!tx || tx.meta?.err) throw new Error(`tx not confirmed on-chain: ${JSON.stringify(tx?.meta?.err)}`);
  console.log(`on-chain: slot ${tx.slot}, fee ${tx.meta?.fee} lamports — OK`);
  console.log(`explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet\n`);

  // Indexer check — poll /projects for raisedAmount
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(`${API_URL}/projects/${PROJECT_ID}`);
    const body = (await res.json()) as { project?: { raisedAmount?: number } } & { raisedAmount?: number };
    const raised = body.project?.raisedAmount ?? body.raisedAmount;
    console.log(`poll ${i + 1}: raisedAmount = ${raised}`);
    if (raised && Number(raised) >= AMOUNT) {
      console.log("\nINDEXED — webhook -> DB roundtrip confirmed. Smoke test PASSED.");
      return;
    }
  }
  console.log("\nWARNING: settled on-chain but indexer has not reflected raisedAmount yet.");
}

main().catch((err) => {
  console.error("SMOKE TEST FAILED:", err);
  process.exit(1);
});
