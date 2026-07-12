/**
 * discovery.ts — deterministic on-chain RPC scan for other registered
 * AgentFund agents (agent_registry's AgentAccount PDAs). No LLM calls.
 *
 * Uses getProgramAccounts with a memcmp filter on the 8-byte Anchor
 * account discriminator (sha256("account:AgentAccount")[0:8]) since this
 * repo has no generated IDL/Program client to lean on (see
 * api/src/services/anchorEncoding.ts's doc comment for why).
 */
import { createHash } from "node:crypto";
import { Connection, PublicKey } from "@solana/web3.js";
import type { CandidateAgent } from "./llm.js";

function accountDiscriminator(accountName: string): Buffer {
  return createHash("sha256").update(`account:${accountName}`).digest().subarray(0, 8);
}

const AGENT_ACCOUNT_DISCRIMINATOR = accountDiscriminator("AgentAccount");

function decodeAgentAccount(pubkey: PublicKey, data: Buffer): CandidateAgent {
  // Layout: 8 (disc) + owner (32) + metadata_uri (Borsh String) +
  // reputation_score (u64, 8) + projects_created (u32, 4) + total_contributed (u64, 8) + bump (u8, 1).
  let offset = 8 + 32;
  const uriLen = data.readUInt32LE(offset);
  offset += 4;
  const metadataUri = data.toString("utf8", offset, offset + uriLen);
  offset += uriLen;
  offset += 8; // reputation_score
  const projectsCreated = data.readUInt32LE(offset);

  return {
    pubkey: pubkey.toBase58(),
    metadataUri: metadataUri || undefined,
    projectsCreated,
  };
}

/**
 * Scans every registered AgentAccount on the configured cluster. Read-only
 * — makes no writes, spends no LLM tokens, and is safe to call as often as
 * needed (the API's own /agents listing would be cheaper for production
 * use, but this agent is deliberately RPC-native so discovery still works
 * even if the API is down).
 */
export async function discoverAgents(
  connection: Connection,
  registryProgramId: string,
): Promise<CandidateAgent[]> {
  const programId = new PublicKey(registryProgramId);
  const accounts = await connection.getProgramAccounts(programId, {
    commitment: "confirmed",
    filters: [{ memcmp: { offset: 0, bytes: AGENT_ACCOUNT_DISCRIMINATOR.toString("base64"), encoding: "base64" } }],
  });

  const candidates: CandidateAgent[] = [];
  for (const { pubkey, account } of accounts) {
    try {
      candidates.push(decodeAgentAccount(pubkey, account.data));
    } catch {
      // Skip anything that doesn't decode cleanly (e.g. a future account
      // layout change) rather than crashing the whole discovery pass.
    }
  }
  return candidates;
}
