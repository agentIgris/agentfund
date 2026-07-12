/**
 * services/ipfs.ts — Pinata JSON pin/fetch for project & agent metadata
 * (title, description, image, category — per the spec's ProjectAccount
 * `ipfs_hash` / AgentAccount `metadata_uri` fields).
 */
import { createHash } from "node:crypto";

import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";

const PINATA_PIN_JSON_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS";
const PINATA_GATEWAY_URL = "https://gateway.pinata.cloud/ipfs";

export interface ProjectMetadata {
  title: string;
  description: string;
  image?: string;
  category?: string;
  /** Link to the project's source repo — an evaluating agent fetches this to inspect the code before contributing. */
  repoUrl?: string;
  website?: string;
  twitter?: string;
  /** Optional first-person note from the human founder, shown alongside the platform-voice description. */
  founderNote?: string;
  /** Per-milestone display descriptions, keyed by on-chain milestone index. */
  milestones?: { index: number; description: string }[];
}

export interface AgentMetadata {
  name?: string;
  description?: string;
  avatar?: string;
}

/**
 * Self-hosted fallback for `pinJson` when PINATA_JWT isn't configured:
 * stores the canonical JSON bytes in the `MetadataBlob` table (upsert —
 * content-addressed by its own sha256, so re-pinning identical content is
 * a no-op) and returns the same
 * `https://<api>/metadata/blob/<hash>#sha256=<hash>` shape already used by
 * the genesis campaign's git-committed metadata, so `resolveMetadataJson`
 * needs no changes to consume either one. This is what keeps
 * `POST /projects` (and agent registration) working in any environment
 * that hasn't set up a paid Pinata account — devnet in particular.
 */
async function pinJsonSelfHosted(data: Record<string, unknown>): Promise<string> {
  const canonical = JSON.stringify(data);
  const hash = createHash("sha256").update(canonical).digest("hex");
  await prisma.metadataBlob.upsert({
    where: { hash },
    create: { hash, content: canonical },
    update: {},
  });
  const base = config.apiBaseUrl.replace(/\/+$/, "");
  return `${base}/metadata/blob/${hash}#sha256=${hash}`;
}

/**
 * Pins arbitrary JSON metadata, returning a reference resolvable by
 * `resolveMetadataJson`. Uses Pinata (a real IPFS CID) when PINATA_JWT is
 * configured; otherwise falls back to the self-hosted content-addressed
 * store above rather than failing every project/agent creation outright.
 */
export async function pinJson(
  data: Record<string, unknown>,
  name?: string,
): Promise<string> {
  if (!config.pinata.jwt) {
    return pinJsonSelfHosted(data);
  }
  const res = await fetch(PINATA_PIN_JSON_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.pinata.jwt}`,
    },
    body: JSON.stringify({
      pinataContent: data,
      pinataMetadata: name ? { name } : undefined,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Pinata pinJSONToIPFS failed: ${res.status} ${body}`);
  }
  const json = (await res.json()) as { IpfsHash: string };
  return json.IpfsHash;
}

/** Fetches and JSON-parses content previously pinned at `ipfsHash`, via Pinata's public gateway. */
export async function fetchIpfsJson<T = Record<string, unknown>>(ipfsHash: string): Promise<T> {
  const res = await fetch(`${PINATA_GATEWAY_URL}/${ipfsHash}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch IPFS content for ${ipfsHash}: ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * Resolves an on-chain metadata reference to parsed JSON. Three forms are
 * accepted, matching what `ProjectAccount.ipfs_hash` may carry:
 *
 *  - `https://…#sha256=<64-hex>` — fetched over HTTP and verified against
 *    the integrity fragment (the devnet content-addressing scheme used by
 *    the genesis campaign: canonical JSON committed to the repo at
 *    metadata/, served by this API under /metadata/, hash pinned on-chain);
 *  - a bare `http(s)://…` URL — fetched and parsed, no integrity check;
 *  - anything else — treated as an IPFS CID via the Pinata gateway
 *    (the original behavior).
 */
export async function resolveMetadataJson<T = Record<string, unknown>>(ref: string): Promise<T> {
  if (ref.startsWith("https://") || ref.startsWith("http://")) {
    // Default keeps `url` typed as `string` (not `string | undefined`) under
    // noUncheckedIndexedAccess — split() on a non-empty separator always
    // returns at least one element, so the default never actually triggers.
    const [url = ref, fragment] = ref.split("#", 2);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch metadata at ${url}: ${res.status}`);
    }
    const body = await res.text();
    const integrity = fragment?.match(/^sha256=([0-9a-f]{64})$/);
    if (integrity) {
      const digest = createHash("sha256").update(body).digest("hex");
      if (digest !== integrity[1]) {
        throw new Error(
          `Metadata integrity check failed for ${url}: expected sha256 ${integrity[1]}, got ${digest}`,
        );
      }
    }
    return JSON.parse(body) as T;
  }
  return fetchIpfsJson<T>(ref);
}

export function pinProjectMetadata(meta: ProjectMetadata): Promise<string> {
  return pinJson(meta as unknown as Record<string, unknown>, `project:${meta.title}`);
}

export function pinAgentMetadata(meta: AgentMetadata): Promise<string> {
  return pinJson(meta as unknown as Record<string, unknown>, `agent:${meta.name ?? "unnamed"}`);
}
