/**
 * routes/metadata.ts — two content-addressed metadata surfaces, both
 * consumed by `services/ipfs.ts`'s `resolveMetadataJson`:
 *
 *  - `GET /metadata/:file` serves the repo's committed `metadata/*.json`
 *    files verbatim — canonical JSON lives in git under `metadata/`, and
 *    the on-chain `ipfs_hash` field points at
 *    `https://api.agentfund.online/metadata/<file>#sha256=<hex>` so any
 *    consumer can verify the served body against the on-chain-pinned
 *    digest without trusting this server. Same "no @fastify/static, plain
 *    GET" style as routes/wellKnown.ts — an explicit allowlist instead of
 *    a generic static-file mount keeps this from ever serving an
 *    arbitrary path.
 *  - `GET /metadata/blob/:hash` is the same scheme generalized to dynamic,
 *    agent-submitted content (project/agent metadata pinned via
 *    `pinJson`'s self-hosted fallback when PINATA_JWT isn't configured):
 *    the row's primary key IS the sha256 of its content, so the route
 *    param is validated as a 64-hex-char digest and used as a direct,
 *    unambiguous lookup key — never an arbitrary path.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// api/{src,dist}/routes/metadata.{ts,js} -> repo root is 3 levels up, same
// depth whether running from src (tsx) or dist (compiled) — see api.Dockerfile.
const METADATA_DIR = path.resolve(__dirname, "../../../metadata");

const ALLOWED_FILES = new Set(["genesis.json", "outreach-agent.json"]);
const HEX64 = /^[0-9a-f]{64}$/;

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

  app.get("/metadata/blob/:hash", async (request, reply) => {
    const { hash } = request.params as { hash: string };
    if (!HEX64.test(hash)) {
      reply.code(400).send({ error: "invalid_request", message: "hash must be a 64-char sha256 hex digest" });
      return;
    }
    const blob = await prisma.metadataBlob.findUnique({ where: { hash } });
    if (!blob) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    reply.type("application/json; charset=utf-8").send(blob.content);
  });
}
