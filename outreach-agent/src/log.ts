/**
 * log.ts — append-only structured log for every outreach decision/action,
 * one JSON object per line (so it's greppable and diffable). Every run of
 * the agent, dry-run or live, writes here.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export interface LogEntry {
  ts: string;
  event: string;
  [key: string]: unknown;
}

export class OutreachLog {
  constructor(private readonly filePath: string) {}

  write(event: string, fields: Record<string, unknown> = {}): void {
    const entry: LogEntry = { ts: new Date().toISOString(), event, ...fields };
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, JSON.stringify(entry) + "\n");
    // eslint-disable-next-line no-console
    console.log(`[outreach] ${entry.ts} ${event}`, fields);
  }
}
