/**
 * Config module — reads all env vars once at startup with sane devnet
 * defaults, so nothing else in the codebase touches `process.env`
 * directly. Cluster-agnostic: SOLANA_CLUSTER / SOLANA_RPC_URL / the USDC
 * mint are all resolved via @agentfund/shared so this workspace never
 * hardcodes a cluster.
 */
import "dotenv/config";
import {
  resolveSolanaCluster,
  resolveSolanaRpcUrl,
  resolveUsdcMint,
  type SolanaCluster,
} from "@agentfund/shared";

function str(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  return "";
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const cluster: SolanaCluster = resolveSolanaCluster(process.env);

export const config = {
  nodeEnv: str("NODE_ENV", "development"),
  isProduction: str("NODE_ENV", "development") === "production",
  host: str("HOST", "0.0.0.0"),
  port: num("PORT", 4000),
  logLevel: str("LOG_LEVEL", "info"),
  corsOrigin: str("CORS_ORIGIN", "*"),

  solana: {
    cluster,
    rpcUrl: resolveSolanaRpcUrl(process.env),
    usdcMint: resolveUsdcMint(process.env),
    registryProgramId: str("REGISTRY_PROGRAM_ID"),
    escrowProgramId: str("ESCROW_PROGRAM_ID"),
    reputationProgramId: str("REPUTATION_PROGRAM_ID"),
    platformWalletKeypairPath: str(
      "PLATFORM_WALLET_KEYPAIR_PATH",
      "~/.config/solana/id.json",
    ),
  },

  database: {
    url: str("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/agentfund"),
  },

  redis: {
    url: str("REDIS_URL", "redis://localhost:6379"),
  },

  auth: {
    jwtSecret: str("JWT_SECRET", "dev-insecure-secret-change-me"),
    jwtExpiresInSeconds: num("JWT_EXPIRES_IN", 3600),
    challengeTtlSeconds: num("AUTH_CHALLENGE_TTL_SECONDS", 300),
  },

  rateLimit: {
    max: num("RATE_LIMIT_MAX", 100),
    windowMs: num("RATE_LIMIT_WINDOW_MS", 60_000),
  },

  webhooks: {
    signingSecret: str("WEBHOOK_SIGNING_SECRET", "") || str("JWT_SECRET", "dev-insecure-secret-change-me"),
    queueName: str("WEBHOOK_DELIVERY_QUEUE_NAME", "webhook-delivery"),
    maxAttempts: num("WEBHOOK_MAX_ATTEMPTS", 5),
  },

  helius: {
    apiKey: str("HELIUS_API_KEY", ""),
    webhookSecret: str("HELIUS_WEBHOOK_SECRET", ""),
    webhookPath: str("HELIUS_WEBHOOK_PATH", "/indexer/helius-webhook"),
  },

  pinata: {
    jwt: str("PINATA_JWT", ""),
  },

  apiBaseUrl: str("API_BASE_URL", `http://localhost:${num("PORT", 4000)}`),
};

export type Config = typeof config;
