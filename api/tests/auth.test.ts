/**
 * tests/auth.test.ts — unit tests for the challenge/verify crypto and
 * parsing logic in src/routes/auth.ts. These exercise the pure, exported
 * helpers directly (no Fastify app, no Redis) since the route handlers
 * themselves depend on a live broker connection.
 */
import { describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  buildChallengeMessage,
  extractNonce,
  verifyChallengeSignature,
} from "../src/routes/auth.js";

function randomNonceHex(): string {
  // Mirrors randomBytes(16).toString("hex") used by the real route.
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

describe("buildChallengeMessage", () => {
  it("embeds the nonce and an ISO timestamp in the expected template", () => {
    const nonce = randomNonceHex();
    const now = new Date("2026-01-01T00:00:00.000Z");
    const message = buildChallengeMessage(nonce, now);

    expect(message).toBe(`Sign in to AgentFund\nNonce: ${nonce}\nTime: 2026-01-01T00:00:00.000Z`);
  });
});

describe("extractNonce", () => {
  it("extracts the nonce token from a well-formed challenge message", () => {
    const nonce = randomNonceHex();
    const message = buildChallengeMessage(nonce, new Date());

    expect(extractNonce(message)).toBe(nonce);
  });

  it("returns undefined when the message has no Nonce line", () => {
    expect(extractNonce("Sign in to AgentFund\nTime: 2026-01-01T00:00:00.000Z")).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(extractNonce("")).toBeUndefined();
  });
});

describe("verifyChallengeSignature", () => {
  it("verifies a valid detached Ed25519 signature over the exact message bytes", () => {
    const keypair = nacl.sign.keyPair();
    const wallet = bs58.encode(Buffer.from(keypair.publicKey));
    const nonce = randomNonceHex();
    const message = buildChallengeMessage(nonce, new Date());

    const signatureBytes = nacl.sign.detached(Buffer.from(message, "utf8"), keypair.secretKey);
    const signature = bs58.encode(Buffer.from(signatureBytes));

    expect(verifyChallengeSignature(message, signature, wallet)).toBe(true);
  });

  it("rejects a signature produced by a different keypair", () => {
    const signer = nacl.sign.keyPair();
    const impostor = nacl.sign.keyPair();
    const wallet = bs58.encode(Buffer.from(impostor.publicKey));
    const message = buildChallengeMessage(randomNonceHex(), new Date());

    const signatureBytes = nacl.sign.detached(Buffer.from(message, "utf8"), signer.secretKey);
    const signature = bs58.encode(Buffer.from(signatureBytes));

    expect(verifyChallengeSignature(message, signature, wallet)).toBe(false);
  });

  it("rejects a signature over a message that was tampered with after signing", () => {
    const keypair = nacl.sign.keyPair();
    const wallet = bs58.encode(Buffer.from(keypair.publicKey));
    const message = buildChallengeMessage(randomNonceHex(), new Date());

    const signatureBytes = nacl.sign.detached(Buffer.from(message, "utf8"), keypair.secretKey);
    const signature = bs58.encode(Buffer.from(signatureBytes));

    const tamperedMessage = `${message}\nExtra: injected`;

    expect(verifyChallengeSignature(tamperedMessage, signature, wallet)).toBe(false);
  });

  it("returns false (never throws) for malformed base58 input", () => {
    expect(verifyChallengeSignature("some message", "not-valid-base58-!!!", "also-not-valid-!!!")).toBe(false);
  });
});
