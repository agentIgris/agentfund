/**
 * registerSelf.ts — idempotent on-chain self-registration for the outreach
 * agent's own identity (agent_registry.register_agent), via the SDK so it
 * exercises the exact same authenticate() + /tx/build + /tx/send path any
 * third-party agent would use.
 *
 * metadataUri points at the self-hosted, content-addressed
 * metadata/outreach-agent.json (see api/src/routes/metadata.ts) which
 * honestly discloses that this agent acts for the human AgentFund team,
 * not as an independent party — required by this task's authorization
 * terms.
 *
 * Run:
 *   OUTREACH_WALLET_PATH=$HOME/.agentfund/outreach-wallet.json \
 *   npx tsx src/registerSelf.ts
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Connection, Keypair } from "@solana/web3.js";
import { AgentFundClient } from "@agentfund/sdk";
import { loadConfig, loadKeypairFile } from "./config.js";

const METADATA_URI =
  "https://api.agentfund.online/metadata/outreach-agent.json#sha256=" +
  "7dd178f1731b96b03f16f360258b7e474d20dca2b678c75cb94f3ded70cdb631";

function loadOrCreateWallet(walletPath: string): Keypair {
  if (existsSync(walletPath)) {
    return Keypair.fromSecretKey(Uint8Array.from(loadKeypairFile(walletPath)));
  }
  const kp = Keypair.generate();
  mkdirSync(path.dirname(walletPath), { recursive: true });
  writeFileSync(walletPath, JSON.stringify(Array.from(kp.secretKey)));
  console.log(`generated new outreach-agent wallet at ${walletPath}: ${kp.publicKey.toBase58()}`);
  return kp;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const wallet = loadOrCreateWallet(cfg.walletPath);
  console.log(`outreach agent wallet: ${wallet.publicKey.toBase58()}`);

  const connection = new Connection(cfg.solanaRpcUrl, "confirmed");
  const balance = await connection.getBalance(wallet.publicKey, "confirmed");
  console.log(`balance: ${balance / 1e9} SOL`);
  if (balance < 0.02 * 1e9) {
    console.log("balance low — requesting a devnet airdrop…");
    const sig = await connection.requestAirdrop(wallet.publicKey, 1e9);
    const bh = await connection.getLatestBlockhash("confirmed");
    await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    console.log(`airdrop tx: ${sig}`);
  }

  const client = new AgentFundClient({ apiUrl: cfg.apiUrl, keypair: wallet });
  await client.authenticate();

  const existing = await client.getAgent(wallet.publicKey.toBase58()).catch(() => null);
  if (existing) {
    console.log("already registered:", existing.agent);
    return;
  }

  const { signature } = await client.registerAgent({
    metadataUri: METADATA_URI,
    name: "AgentFund Outreach Agent",
    description: "Official AgentFund fundraiser, acting for the human AgentFund team.",
  });
  console.log(`register_agent tx: ${signature}`);
  console.log(`https://explorer.solana.com/tx/${signature}?cluster=devnet`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
