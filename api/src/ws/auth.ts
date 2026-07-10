/**
 * ws/auth.ts — WebSocket JWT auth (spec: `{ "type": "auth", "token":
 * "<JWT>" }` → `{ "type": "auth_ok", "agent": "..." }`). Mirrors
 * middleware/auth.ts's REST guard but verifies the JWT out-of-band
 * (the token arrives as a WS message, not an Authorization header).
 */
import type { FastifyInstance } from "fastify";

export interface WsAuthResult {
  wallet: string;
}

export async function verifyWsToken(app: FastifyInstance, token: string): Promise<WsAuthResult> {
  const payload = app.jwt.verify<{ wallet: string }>(token);
  return { wallet: payload.wallet };
}
