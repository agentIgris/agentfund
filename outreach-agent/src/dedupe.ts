/**
 * dedupe.ts — one-contact-per-agent, persisted to disk so it survives
 * restarts. Keyed by the target agent's base58 pubkey.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface ContactedRecord {
  pubkey: string;
  contactedAt: string;
  mode: "llm" | "template";
  dryRun: boolean;
}

export class DedupeStore {
  private readonly filePath: string;
  private records: Map<string, ContactedRecord>;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "contacted.json");
    this.records = this.load();
  }

  private load(): Map<string, ContactedRecord> {
    if (!existsSync(this.filePath)) return new Map();
    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as ContactedRecord[];
      return new Map(raw.map((r) => [r.pubkey, r]));
    } catch {
      return new Map();
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify([...this.records.values()], null, 2));
  }

  hasContacted(pubkey: string): boolean {
    return this.records.has(pubkey);
  }

  markContacted(record: ContactedRecord): void {
    this.records.set(record.pubkey, record);
    this.save();
  }

  get size(): number {
    return this.records.size;
  }
}
