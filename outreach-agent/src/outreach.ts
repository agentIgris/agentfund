/**
 * outreach.ts — the daily fundraising run. Orchestrates the deterministic
 * pieces (discovery, dedupe, budget, logging) around the one LLM-backed
 * step (message composition).
 *
 * IMPORTANT — delivery boundary: AgentFund's on-chain programs have no
 * agent-to-agent messaging instruction, and this agent does not invent one
 * by POSTing to arbitrary third-party endpoints it discovers. "Contact" for
 * every agent this loop discovers therefore means: compose a message and
 * record it in outreach.log as a logged draft — nothing is transmitted to
 * that agent's own infrastructure. This is true for EVERY candidate,
 * regardless of dry-run/live mode; live mode only changes whether the LLM
 * (vs. a template) writes the text, and whether real token budget is spent.
 *
 * The three keypairs in devnet-agents/ are the one exception: they are
 * OWNED by this team, so "contacting" them safely means actually
 * transacting AS them against the live platform — that's what e2e.ts does,
 * separately from this discovery loop.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { Connection, Keypair } from "@solana/web3.js";
import { loadConfig, loadKeypairFile, isDryRun, type OutreachConfig } from "./config.js";
import { BudgetGuard } from "./budget.js";
import { DedupeStore } from "./dedupe.js";
import { OutreachLog } from "./log.js";
import { discoverAgents } from "./discovery.js";
import { composeMessage, type CandidateAgent } from "./llm.js";

function loadOwnCustomerAgentPubkeys(dir: string): Set<string> {
  const result = new Set<string>();
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return result; // dir doesn't exist on this machine — treat as "no own agents known"
  }
  for (const file of files) {
    try {
      const secret = loadKeypairFile(path.join(dir, file));
      const kp = Keypair.fromSecretKey(Uint8Array.from(secret));
      result.add(kp.publicKey.toBase58());
    } catch {
      // not a valid keypair file — skip
    }
  }
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RunSummary {
  discovered: number;
  alreadyContacted: number;
  processed: number;
  skippedBudget: number;
  ownCustomerAgents: number;
  dryRun: boolean;
}

export async function runOnce(cfg: OutreachConfig = loadConfig()): Promise<RunSummary> {
  const log = new OutreachLog(cfg.logFile);
  const dryRun = isDryRun(cfg);
  const budget = new BudgetGuard(cfg.dataDir, cfg.dailyTokenSoftStop, cfg.dailyTokenBudget);
  const dedupe = new DedupeStore(cfg.dataDir);
  const ownAgents = loadOwnCustomerAgentPubkeys(cfg.ownCustomerAgentsDir);

  log.write("run.start", {
    dryRun,
    apiUrl: cfg.apiUrl,
    rpcUrl: cfg.solanaRpcUrl,
    budgetSpentToday: budget.spentToday,
    budgetSoftStop: cfg.dailyTokenSoftStop,
    knownOwnAgents: ownAgents.size,
    alreadyContactedTotal: dedupe.size,
  });

  const connection = new Connection(cfg.solanaRpcUrl, "confirmed");
  let candidates: CandidateAgent[] = [];
  try {
    candidates = await discoverAgents(connection, cfg.registryProgramId);
  } catch (err) {
    log.write("run.discovery_failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }

  const fresh = candidates.filter((c) => !dedupe.hasContacted(c.pubkey));
  log.write("run.discovered", { total: candidates.length, fresh: fresh.length });

  let processed = 0;
  let skippedBudget = 0;

  for (const candidate of fresh.slice(0, cfg.batchSize)) {
    const isOwn = ownAgents.has(candidate.pubkey);

    if (!dryRun && budget.wouldExceed(220)) {
      // Soft-stop hit for today — fall back to template for the rest of this run
      // rather than silently stopping outreach altogether.
      log.write("run.budget_soft_stop", { spentToday: budget.spentToday, softStop: cfg.dailyTokenSoftStop });
      skippedBudget += fresh.length - processed;
      break;
    }

    let composed;
    try {
      composed = await composeMessage(cfg, candidate);
    } catch (err) {
      log.write("contact.compose_failed", {
        pubkey: candidate.pubkey,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (composed.tokensUsed > 0) budget.record(composed.tokensUsed);

    log.write("contact.drafted", {
      pubkey: candidate.pubkey,
      isOwnCustomerAgent: isOwn,
      mode: composed.mode,
      dryRun,
      tokensUsed: composed.tokensUsed,
      message: composed.text,
      delivery: isOwn
        ? "own-agent (not messaged here — see e2e.ts for live customer-journey testing)"
        : "logged-only (no agent-to-agent messaging transport exists on-chain; external contact is never transmitted)",
    });

    dedupe.markContacted({
      pubkey: candidate.pubkey,
      contactedAt: new Date().toISOString(),
      mode: composed.mode,
      dryRun,
    });

    processed += 1;
    await sleep(cfg.minDelayMsBetweenContacts);
  }

  const summary: RunSummary = {
    discovered: candidates.length,
    alreadyContacted: candidates.length - fresh.length,
    processed,
    skippedBudget,
    ownCustomerAgents: ownAgents.size,
    dryRun,
  };
  log.write("run.complete", { ...summary });
  return summary;
}
