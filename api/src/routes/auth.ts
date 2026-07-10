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

    // Single-use, 5-minute TTL (config.auth.challengeTtlSeconds) nonce → wallet mapping.
    await broker.connection.set(
      `${NONCE_KEY_PREFIX}${nonce}`,
      wallet,
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
    const storedWallet = await (broker.connection as unknown as { getdel(k: string): Promise<string | null> }).getdel(key);
    if (!storedWallet || storedWallet !== wallet) {
      return reply.code(401).send({ error: "invalid_or_expired_challenge" });
    }

    const verified = verifyChallengeSignature(message, signature, wallet);

    if (!verified) {
      return reply.code(401).send({ error: "invalid_signature" });
    }

    const token = await reply.jwtSign({ wallet }, { expiresIn: config.auth.jwtExpiresInSeconds });
    return reply.send({ token, expires: config.auth.jwtExpiresInSeconds });
  });
}
