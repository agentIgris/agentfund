#!/usr/bin/env node
/**
 * cli.ts — entry point.
 *
 *   tsx src/cli.ts --once   run a single discovery/outreach pass and exit
 *   tsx src/cli.ts --loop   run forever, once per OUTREACH_LOOP_INTERVAL_MS (default 24h)
 *
 * Config is env-only (see config.ts / .env.example) — no CLI flags for
 * secrets or provider settings.
 */
import { loadConfig, isDryRun } from "./config.js";
import { runOnce } from "./outreach.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const mode = process.argv.includes("--loop") ? "loop" : "once";
  const cfg = loadConfig();

  console.log(
    `AgentFund outreach agent — mode=${mode} dryRun=${isDryRun(cfg)} apiUrl=${cfg.apiUrl} ` +
      `dailyBudget=${cfg.dailyTokenBudget} softStop=${cfg.dailyTokenSoftStop}`,
  );

  if (mode === "once") {
    const summary = await runOnce(cfg);
    console.log("run summary:", summary);
    return;
  }

  for (;;) {
    try {
      const summary = await runOnce(cfg);
      console.log("run summary:", summary);
    } catch (err) {
      console.error("run failed:", err);
    }
    await sleep(cfg.loopIntervalMs);
  }
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
