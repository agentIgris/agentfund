/**
 * llm.ts — thin OpenAI-chat-completions-compatible client, plus the
 * deterministic template fallback used whenever OUTREACH_LLM_BASE_URL is
 * unset (dry-run / no-key mode). The LLM only ever composes message TEXT;
 * every decision about WHO to contact, WHETHER to actually send anything,
 * and rate limiting/dedupe/budget enforcement is deterministic code in
 * outreach.ts, discovery.ts, budget.ts, dedupe.ts — never delegated to the
 * model.
 */
import type { OutreachConfig } from "./config.js";

export interface CandidateAgent {
  pubkey: string;
  metadataUri?: string;
  projectsCreated: number;
}

export interface ComposedMessage {
  text: string;
  mode: "llm" | "template";
  tokensUsed: number;
}

const SYSTEM_PROMPT = `You are the official AgentFund outreach agent, writing on behalf of the human AgentFund team \
(not as an independent agent). AgentFund is fundraising infrastructure for AI agents on Solana devnet — \
escrow-backed, milestone-voted crowdfunding with x402 micropayments. Your job: write a short, honest, \
non-spammy message inviting another registered on-chain agent to check out AgentFund's genesis campaign \
and consider using the platform to raise (or support) funding for its own work. Never claim to be an \
independent agent, never promise anything AgentFund doesn't actually do, never pressure. Under 400 characters, \
plain text, no markdown.`;

function templateMessage(candidate: CandidateAgent): string {
  return (
    `Hi — we're AgentFund's outreach agent, writing for the human AgentFund team. ` +
    `AgentFund is escrow-backed, milestone-voted crowdfunding for AI agents on Solana ` +
    `(x402 micropayments, on-chain votes release funds). We noticed your agent ` +
    `(${candidate.pubkey.slice(0, 8)}…) is registered on-chain and thought you might want to check out ` +
    `the genesis campaign or raise your own funding round: https://agentfund.online. No pressure — just an intro.`
  );
}

/**
 * Composes an outreach message for `candidate`. In dry-run mode (no base
 * URL configured) this NEVER makes a network call — pure template, zero
 * tokens spent, matching the "zero LLM calls" dry-run contract.
 */
export async function composeMessage(
  cfg: OutreachConfig,
  candidate: CandidateAgent,
): Promise<ComposedMessage> {
  if (cfg.llm.baseUrl === "") {
    return { text: templateMessage(candidate), mode: "template", tokensUsed: 0 };
  }

  const body = {
    model: cfg.llm.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `Write the outreach message for this candidate agent. Pubkey: ${candidate.pubkey}. ` +
          `Metadata URI: ${candidate.metadataUri ?? "(none)"}. Projects created: ${candidate.projectsCreated}.`,
      },
    ],
    max_tokens: 220,
    temperature: 0.7,
  };

  const res = await fetch(`${cfg.llm.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.llm.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`LLM call failed: ${res.status} ${errText.slice(0, 500)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { total_tokens?: number };
  };

  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("LLM response had no message content");
  }
  const tokensUsed = json.usage?.total_tokens ?? 0;

  return { text, mode: "llm", tokensUsed };
}
