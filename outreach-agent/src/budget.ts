/**
 * budget.ts — daily LLM token budget guard, persisted to disk as
 * { date: "YYYY-MM-DD", count: number } so it survives process restarts
 * (the daily loop, or repeated `--once` invocations from cron/systemd).
 * Deterministic, no LLM calls of its own.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface BudgetState {
  date: string;
  count: number;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export class BudgetGuard {
  private state: BudgetState;
  private readonly filePath: string;

  constructor(
    dataDir: string,
    private readonly softStop: number,
    private readonly hardCap: number,
  ) {
    this.filePath = path.join(dataDir, "budget.json");
    this.state = this.load();
  }

  private load(): BudgetState {
    const today = todayUtc();
    if (existsSync(this.filePath)) {
      try {
        const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as BudgetState;
        if (raw.date === today && Number.isFinite(raw.count)) {
          return raw;
        }
      } catch {
        // corrupt/missing file — fall through to a fresh counter
      }
    }
    return { date: today, count: 0 };
  }

  private save(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  /** Rolls over to a fresh day's counter if the calendar date (UTC) has changed. */
  private rollover(): void {
    const today = todayUtc();
    if (this.state.date !== today) {
      this.state = { date: today, count: 0 };
    }
  }

  get spentToday(): number {
    this.rollover();
    return this.state.count;
  }

  /** True if spending `tokens` more would exceed the soft-stop threshold. */
  wouldExceed(tokens: number): boolean {
    this.rollover();
    return this.state.count + tokens > this.softStop;
  }

  get remaining(): number {
    this.rollover();
    return Math.max(0, this.softStop - this.state.count);
  }

  get hardCapRemaining(): number {
    this.rollover();
    return Math.max(0, this.hardCap - this.state.count);
  }

  /** Records actual token spend (call with the real usage.total_tokens from the LLM response). */
  record(tokens: number): void {
    this.rollover();
    this.state.count += Math.max(0, Math.trunc(tokens));
    this.save();
  }
}
