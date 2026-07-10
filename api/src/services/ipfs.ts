/**
 * services/ipfs.ts — Pinata JSON pin/fetch for project & agent metadata
 * (title, description, image, category — per the spec's ProjectAccount
 * `ipfs_hash` / AgentAccount `metadata_uri` fields).
 */
import { config } from "../config.js";

const PINATA_PIN_JSON_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS";
const PINATA_GATEWAY_URL = "https://gateway.pinata.cloud/ipfs";

export interface ProjectMetadata {
  title: string;
  description: string;
  image?: string;
  category?: string;
}

export interface AgentMetadata {
  name?: string;
  description?: string;
  avatar?: string;
}

/** Pins arbitrary JSON metadata to IPFS via Pinata, returning the CID (`ipfsHash`). */
export async function pinJson(
  data: Record<string, unknown>,
  name?: string,
): Promise<string> {
  if (!config.pinata.jwt) {
    throw new Error("PINATA_JWT is not configured — cannot pin metadata to IPFS");
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

export function pinProjectMetadata(meta: ProjectMetadata): Promise<string> {
  return pinJson(meta as unknown as Record<string, unknown>, `project:${meta.title}`);
}

export function pinAgentMetadata(meta: AgentMetadata): Promise<string> {
  return pinJson(meta as unknown as Record<string, unknown>, `agent:${meta.name ?? "unnamed"}`);
}
