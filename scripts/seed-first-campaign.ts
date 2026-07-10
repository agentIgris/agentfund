#!/usr/bin/env -S npx tsx
/**
 * scripts/seed-first-campaign.ts
 *
 * One-shot seeding script: registers the platform's own wallet as an
 * on-chain agent and creates AgentFund's first fundraising campaign,
 * "Gold AI Trading Ecosystem — Infrastructure" (goal: 10,000 USDC, 30-day
 * deadline, 3 milestones), using nothing but the public @agentfund/sdk —
 * i.e. exactly the same code path any third-party agent would use.
 *
 * Flow (spec: "Project Lifecycle" steps 1-4):
 *   1. Load the platform wallet keypair from PLATFORM_WALLET_KEYPAIR_PATH.
 *   2. authenticate() — Solana-native challenge/sign/verify handshake.
 *   3. registerAgent() — registers the wallet as an on-chain AgentAccount
 *      (idempotent-ish: if it's already registered, the on-chain send
 *      will fail with "already in use" and we just log + continue).
 *   4. createProject() — the API pins {title, description, category}
 *      metadata to IPFS via Pinata (services/ipfs.ts) *before* building
 *      the unsigned `create_project` instruction; this script only sees
 *      the resulting `unsignedTx`, signs it locally with the platform
 *      keypair, and submits it via /tx/send. This is the "pin campaign
 *      metadata to IPFS via the API" step — the pinning itself happens
 *      server-side as part of this one call.
 *
 * Usage:
 *   npx tsx scripts/seed-first-campaign.ts
 *
 * Required env (see repo-root .env.example + scripts/.env.example):
 *   PLATFORM_WALLET_KEYPAIR_PATH   path to a Solana CLI keypair JSON file
 *   API_BASE_URL                   AgentFund REST API base URL
 *   SOLANA_CLUSTER                 "devnet" | "mainnet-beta" (for the Solscan link)
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
import { resolveSolanaCluster } from "@agentfund/shared";
import { AgentFundClient, Keypair, AgentFundApiError } from "@agentfund/sdk";

const USDC_DECIMALS = 6;
const SECONDS_PER_DAY = 86_400;
const CAMPAIGN_DEADLINE_DAYS = 30;

function usdc(amount: number): number {
  return Math.round(amount * 10 ** USDC_DECIMALS);
}

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : fallback;
}

/** Expands a leading `~` the way the Solana CLI does, so PLATFORM_WALLET_KEYPAIR_PATH can use `~/.config/solana/id.json`. */
function expandHome(path: string): string {
  if (path === "~" || path.startsWith("~/") || path.startsWith("~\\")) {
    return resolvePath(homedir(), path.slice(2));
  }
  return path;
}

function loadPlatformKeypair(): Keypair {
  const path = str("PLATFORM_WALLET_KEYPAIR_PATH", "~/.config/solana/id.json");
  const resolved = expandHome(path);
  let raw: string;
  try {
    raw = readFileSync(resolved, "utf8");
  } catch (err) {
    throw new Error(
      `Could not read platform wallet keypair at "${resolved}" (from PLATFORM_WALLET_KEYPAIR_PATH). ` +
        `Generate one with \`solana-keygen new -o ${resolved}\` and fund it with SOL for tx fees. ` +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const secretKey = Uint8Array.from(JSON.parse(raw) as number[]);
  return Keypair.fromSecretKey(secretKey);
}

function solscanTxUrl(signature: string, cluster: string, solscanBaseUrl: string): string {
  const suffix = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `${solscanBaseUrl}/tx/${signature}${suffix}`;
}

async function main(): Promise<void> {
  const apiUrl = str("API_BASE_URL", "http://localhost:4000");
  const frontendBaseUrl = str("FRONTEND_BASE_URL", "https://predictbgmi.fun").replace(/\/+$/, "");
  const solscanBaseUrl = str("SOLSCAN_BASE_URL", "https://solscan.io").replace(/\/+$/, "");
  const cluster = resolveSolanaCluster(process.env);

  console.log(`AgentFund — seeding first campaign`);
  console.log(`  API:     ${apiUrl}`);
  console.log(`  Cluster: ${cluster}`);

  const keypair = loadPlatformKeypair();
  const client = new AgentFundClient({ apiUrl, keypair });
  console.log(`  Wallet:  ${client.wallet}`);

  console.log(`\n[1/3] Authenticating (Solana-keypair challenge/verify)...`);
  await client.authenticate();
  console.log(`  Authenticated.`);

  console.log(`\n[2/3] Registering platform wallet as an on-chain agent...`);
  try {
    const { signature } = await client.registerAgent({
      name: "AgentFund Platform",
      description: "The AgentFund platform's own operating wallet — seeds the first public campaign.",
    });
    console.log(`  Registered. tx: ${solscanTxUrl(signature, cluster, solscanBaseUrl)}`);
  } catch (err) {
    // Already registered (on-chain AgentAccount PDA already initialized) is
    // fine — this script is safe to re-run.
    console.log(
      `  Skipping (already registered, or registration failed non-fatally): ${
        err instanceof AgentFundApiError ? err.message : String(err)
      }`,
    );
  }

  console.log(`\n[3/3] Creating campaign "Gold AI Trading Ecosystem — Infrastructure"...`);
  console.log(`  (metadata is pinned to IPFS server-side, inside this call)`);
  const deadline = Math.floor(Date.now() / 1000) + CAMPAIGN_DEADLINE_DAYS * SECONDS_PER_DAY;

  const { projectId, signature } = await client.createProject({
    title: "Gold AI Trading Ecosystem — Infrastructure",
    description:
      "Infrastructure funding for the Gold AI Trading Ecosystem: dedicated RPC capacity, " +
      "real-time market data feeds, and deployment/operations for autonomous trading agents.",
    category: "infrastructure",
    goalAmount: usdc(10_000),
    token: "USDC",
    deadline,
    milestones: [
      { description: "RPC & infrastructure", amount: usdc(3_000) },
      { description: "Market data feeds", amount: usdc(3_000) },
      { description: "Deployment & operations", amount: usdc(4_000) },
    ],
  });

  console.log(`\nCampaign created.`);
  console.log(`  Project ID:   ${projectId}`);
  console.log(`  Project URL:  ${frontendBaseUrl}/projects/${projectId}`);
  console.log(`  Solscan (tx): ${solscanTxUrl(signature, cluster, solscanBaseUrl)}`);

  console.log(`\nWaiting for on-chain confirmation...`);
  const status = await client.waitForConfirmation(signature, { timeoutMs: 60_000 });
  if (status.confirmed) {
    console.log(`  Confirmed.`);
  } else {
    console.log(`  Not yet confirmed after 60s (err: ${status.err ?? "none"}). Check the Solscan link above.`);
  }
}

main().catch((err) => {
  console.error(`\nSeed script failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exitCode = 1;
});
