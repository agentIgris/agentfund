/**
 * middleware/auth.ts — JWT auth guard for protected REST routes. Verifies
 * the `Authorization: Bearer <JWT>` header (issued by POST /auth/verify)
 * and attaches the recovered wallet pubkey to `request.agentWallet`.
 * The equivalent for WebSocket connections lives in ws/auth.ts.
 */
import type { FastifyReply, FastifyRequest } from "fastify";

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const payload = await request.jwtVerify<{ wallet: string }>();
    request.agentWallet = payload.wallet;
  } catch {
    await reply.code(401).send({ error: "unauthorized", message: "Missing or invalid bearer token" });
  }
}
