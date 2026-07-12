/**
 * Cluster-agnostic Solana configuration. Reads SOLANA_CLUSTER and
 * SOLANA_RPC_URL from env — never hardcode a cluster in application
 * code. Anchor programs and every TS workspace must derive PDA seeds
 * from the constants exported here so they stay in agreement.
 */

export type SolanaCluster = "devnet" | "mainnet-beta";

/** USDC-SPL mint addresses, keyed by cluster. */
export const USDC_MINT: Record<SolanaCluster, string> = {
  "mainnet-beta": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};

/** Sentinel mint value used to represent native SOL (no SPL mint). */
export const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * Resolves the active Solana cluster from env. Defaults to "devnet"
 * when unset or invalid, since devnet is the safe default for local
 * development.
 */
export function resolveSolanaCluster(
  env: Record<string, string | undefined> = process.env,
): SolanaCluster {
  const raw = env.SOLANA_CLUSTER;
  if (raw === "mainnet-beta" || raw === "devnet") {
    return raw;
  }
  return "devnet";
}

/**
 * Resolves the RPC URL to use. Prefers SOLANA_RPC_URL from env; falls
 * back to the public cluster endpoint for the resolved cluster.
 */
export function resolveSolanaRpcUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  if (env.SOLANA_RPC_URL) {
    return env.SOLANA_RPC_URL;
  }
  const cluster = resolveSolanaCluster(env);
  return cluster === "mainnet-beta"
    ? "https://api.mainnet-beta.solana.com"
    : "https://api.devnet.solana.com";
}

/** Resolves the USDC mint for the active cluster (from env by default). */
export function resolveUsdcMint(
  env: Record<string, string | undefined> = process.env,
): string {
  return USDC_MINT[resolveSolanaCluster(env)];
}

// ─────────────────────────────────────────────────────────────
// PDA seed constants
// Must match the byte-for-byte seed strings used in the Anchor
// programs' `seeds = [...]` constraints (programs/*/src/lib.rs).
// ─────────────────────────────────────────────────────────────

export const PDA_SEEDS = {
  CONFIG: "config",
  AGENT: "agent",
  PROJECT: "project",
  ESCROW: "escrow",
  CONTRIBUTION: "contribution",
  VOTE: "vote",
  REPUTATION: "reputation",
} as const;

export type PdaSeedKey = keyof typeof PDA_SEEDS;
