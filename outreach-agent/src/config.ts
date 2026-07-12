/**
 * config.ts — every knob this agent reads comes from process.env. Never
 * hardcode a provider URL, API key, or secret here; never commit a real
 * .env (see outreach-agent/.env.example).
 *
 * Safety posture (do not loosen without explicit human sign-off):
 *   - No OUTREACH_LLM_BASE_URL set -> DRY RUN. Zero LLM calls, template
 *     messages only, nothing written except outreach.log.
 *   - Even in live (LLM-enabled) mode, outreach never contacts a
 *     third-party agent it doesn't control — see discovery.ts /
 *     outreach.ts. The only pubkeys this agent is authorized to actually
 *     transact with (E2E testing) are the ones in OWN_CUSTOMER_AGENTS.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function str(name: string, fallback = ""): string {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : fallback;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export interface OutreachConfig {
  apiUrl: string;
  solanaRpcUrl: string;
  registryProgramId: string;

  llm: {
    /** Empty string => dry-run mode (no LLM calls at all). */
    baseUrl: string;
    apiKey: string;
    model: string;
  };

  /** Hard daily token ceiling communicated by the operator. */
  dailyTokenBudget: number;
  /** Soft stop — the guard refuses further LLM calls past this, leaving headroom under dailyTokenBudget. */
  dailyTokenSoftStop: number;

  /** How many outreach candidates to process per run (--once or one loop tick). */
  batchSize: number;
  /** Minimum ms between LLM-composed messages, crude self-imposed rate limit. */
  minDelayMsBetweenContacts: number;
  /** Daily-loop interval, ms. */
  loopIntervalMs: number;

  /** Directory for disk-persisted state (budget counter, dedupe set). */
  dataDir: string;
  logFile: string;

  /**
   * The three keypairs this team controls end-to-end (E:\AIfundraising\devnet-agents\
   * on the operator's machine) — the only pubkeys "contact" can mean more than
   * "logged draft, not sent" for. Populated at runtime from
   * OUTREACH_OWN_CUSTOMER_AGENTS_DIR by discovery.ts; kept here as the single
   * source of truth for the env var name.
   */
  ownCustomerAgentsDir: string;

  /** This agent's own devnet keypair (for register_agent + any live tx it sends). */
  walletPath: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): OutreachConfig {
  const dailyTokenBudget = num("OUTREACH_DAILY_TOKEN_BUDGET", 5_000_000);
  return {
    apiUrl: str("OUTREACH_API_URL", "https://api.agentfund.online"),
    solanaRpcUrl: str("SOLANA_RPC_URL", "https://api.devnet.solana.com"),
    registryProgramId: str("REGISTRY_PROGRAM_ID", "2TqDeKaadPUeBcgaXXqYAqddfZngUfbq4m8iDSyePSBA"),

    llm: {
      baseUrl: str("OUTREACH_LLM_BASE_URL"),
      apiKey: str("OUTREACH_LLM_API_KEY"),
      model: str("OUTREACH_LLM_MODEL", "gpt-4o-mini"),
    },

    dailyTokenBudget,
    dailyTokenSoftStop: num("OUTREACH_DAILY_TOKEN_SOFT_STOP", Math.floor(dailyTokenBudget * 0.9)),

    batchSize: num("OUTREACH_BATCH_SIZE", 10),
    minDelayMsBetweenContacts: num("OUTREACH_MIN_DELAY_MS", 1500),
    loopIntervalMs: num("OUTREACH_LOOP_INTERVAL_MS", 24 * 60 * 60 * 1000),

    dataDir: str("OUTREACH_DATA_DIR", path.join(process.cwd(), "outreach-agent", "data")),
    logFile: str("OUTREACH_LOG_FILE", path.join(process.cwd(), "outreach-agent", "outreach.log")),

    ownCustomerAgentsDir: str("OUTREACH_OWN_CUSTOMER_AGENTS_DIR", path.join(process.cwd(), "..", "devnet-agents")),

    walletPath: str("OUTREACH_WALLET_PATH", path.join(os.homedir(), ".agentfund", "outreach-wallet.json")),
  };
}

export function isDryRun(cfg: OutreachConfig): boolean {
  return cfg.llm.baseUrl === "";
}

export function loadKeypairFile(filePath: string): number[] {
  return JSON.parse(readFileSync(filePath, "utf8")) as number[];
}
