/**
 * routes/auth.ts — Solana keypair challenge/verify (spec: "Agent
 * Authentication (Solana-Native)"). No smart-contract call: a
 * `nacl.sign.detached.verify` against a short-lived, single-use, Redis-
 * backed nonce is sufficient because the wallet's keypair IS the
 * identity.
 */
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { authVerifyRequestSchema } from "@agentfund/shared";
import { z } from "zod";
import { config } from "../config.js";
import { broker } from "../services/broker.js";
import { base58PubkeySchema } from "../schema/common.js";

const NONCE_KEY_PREFIX = "agentfund:authchallenge:";
const NONCE_RE = /Nonce: (\S+)/;

const challengeQuerySchema = z.object({ wallet: base58PubkeySchema });

/** Builds the exact message the agent must sign for a given nonce (spec: "Sign in to AgentFund\nNonce: ...\nTime: ..."). Exported for unit testing. */
export function buildChallengeMessage(nonce: string, now: Date = new Date()): string {
  return `Sign in to AgentFund\nNonce: ${nonce}\nTime: ${now.toISOString()}`;
}

/** Extracts the nonce embedded in a signed challenge message. Exported for unit testing. */
export function extractNonce(message: string): string | undefined {
  return NONCE_RE.exec(message)?.[1];
}

/** Verifies a base58-encoded Ed25519 detached signature over a message, for a base58 wallet pubkey. Exported for unit testing. */
export function verifyChallengeSignature(message: string, signature: string, wallet: string): boolean {
  try {
    return nacl.sign.detached.verify(Buffer.from(message, "utf8"), bs58.decode(signature), bs58.decode(wallet));
  } catch {
    return false;
  }
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.get("/auth/challenge", async (request, reply) => {
    const parsed = challengeQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    const { wallet } = parsed.data;

    const nonce = randomBytes(16).toString("hex");
    const message = buildChallengeMessage(nonce);

    // Single-use, 5-minute TTL (config.auth.challengeTtlSeconds) nonce → {wallet, message}.
    // We persist the EXACT canonical message (incl. its timestamp) so /auth/verify can
    // reject any client-supplied message that isn't byte-identical to what we issued.
    await broker.connection.set(
      `${NONCE_KEY_PREFIX}${nonce}`,
      JSON.stringify({ wallet, message }),
      "EX",
      config.auth.challengeTtlSeconds,
    );

    return reply.send({ nonce, message });
  });

  app.post("/auth/verify", async (request, reply) => {
    const parsed = authVerifyRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    const { wallet, signature, message } = parsed.data;

    const nonce = extractNonce(message);
    if (!nonce) {
      return reply.code(400).send({ error: "invalid_message", message: "Message missing Nonce" });
    }
    const key = `${NONCE_KEY_PREFIX}${nonce}`;

    // Single-use: atomically fetch-and-delete so a replayed challenge can never verify twice.
    const stored = await (broker.connection as unknown as { getdel(k: string): Promise<string | null> }).getdel(key);
    if (!stored) {
      return reply.code(401).send({ error: "invalid_or_expired_challenge" });
    }

    let storedWallet: string;
    let storedMessage: string;
    try {
      ({ wallet: storedWallet, message: storedMessage } = JSON.parse(stored));
    } catch {
      return reply.code(401).send({ error: "invalid_or_expired_challenge" });
    }

    // Bind the challenge to the wallet AND require the submitted message to be
    // byte-for-byte the canonical message we issued. Without this equality check
    // an attacker could get a signature verified over an arbitrary message of
    // their choosing (the nonce substring alone is not sufficient binding).
    if (storedWallet !== wallet || storedMessage !== message) {
      return reply.code(401).send({ error: "invalid_or_expired_challenge" });
    }

    const verified = verifyChallengeSignature(storedMessage, signature, wallet);

    if (!verified) {
      return reply.code(401).send({ error: "invalid_signature" });
    }

    const token = await reply.jwtSign({ wallet }, { expiresIn: config.auth.jwtExpiresInSeconds });
    return reply.send({ token, expires: config.auth.jwtExpiresInSeconds });
  });
}
