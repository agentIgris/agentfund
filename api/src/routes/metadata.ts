/**
 * routes/metadata.ts — serves the repo's committed `metadata/*.json` files
 * verbatim at `GET /metadata/:file`. This is the devnet content-addressing
 * scheme referenced by `services/ipfs.ts`'s `resolveMetadataJson`: canonical
 * JSON lives in git under `metadata/`, this route serves the exact bytes,
 * and the on-chain `ipfs_hash` field points at
 * `https://api.agentfund.online/metadata/<file>#sha256=<hex>` so any
 * consumer can verify the served body against the on-chain-pinned digest
 * without trusting this server. Same "no @fastify/static, plain GET" style
 * as routes/wellKnown.ts — an explicit allowlist instead of a generic
 * static-file mount keeps this from ever serving an arbitrary path.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { FastifyInstance } from "fastify";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// api/{src,dist}/routes/metadata.{ts,js} -> repo root is 3 levels up, same
// depth whether running from src (tsx) or dist (compiled) — see api.Dockerfile.
const METADATA_DIR = path.resolve(__dirname, "../../../metadata");

const ALLOWED_FILES = new Set(["genesis.json", "outreach-agent.json"]);

export function registerMetadataRoutes(app: FastifyInstance): void {
  app.get("/metadata/:file", async (request, reply) => {
    const { file } = request.params as { file: string };
    if (!ALLOWED_FILES.has(file)) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    // Read fresh on every request rather than caching in memory — these
    // files are small and this keeps a git pull + redeploy immediately
    // reflected with no stale-cache surprises.
    const body = readFileSync(path.join(METADATA_DIR, file), "utf8");
    reply.type("application/json; charset=utf-8").send(body);
  });
}
