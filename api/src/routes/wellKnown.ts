/**
 * routes/wellKnown.ts — static `/.well-known/*` responses served straight
 * from Fastify (no @fastify/static dependency, no Caddy file mount) so
 * every well-known file lives in git next to the code that needs it.
 * Registered before the x402 routes' path space is even touched, so
 * these never risk hitting x402/rate-limit middleware behavior tied to
 * a specific route — they're plain GETs returning fixed bodies.
 */
import type { FastifyInstance } from "fastify";
import { PublicKey } from "@solana/web3.js";
import { resolveUsdcMint } from "@agentfund/shared";
import { deriveEscrowPda } from "../services/solana.js";

const DONATE_PROJECT_ID = "9RRsXtiCFu2RmGBcqcjosxek1QLjWVW8Z74hvJ6Bjh8H";

export function registerWellKnownRoutes(app: FastifyInstance): void {
  // 402 Index domain-ownership proof (api/v1/claim → serve verification_hash
  // verbatim as plaintext). Value comes from an env var, not a committed
  // file, since the hash is account-bound to whoever claims the domain.
  app.get("/.well-known/402index-verify.txt", async (_request, reply) => {
    const hash = process.env.INDEX_402_VERIFICATION_HASH ?? "";
    reply.type("text/plain").send(hash);
  });

  // x402 discovery manifest (community `.well-known/x402.json` convention —
  // no single locked-down schema; this follows the common shape used by
  // x402 Bazaar-style listings: one entry per payable resource under
  // `accepts`, plus a templated pattern for the general donate route).
  app.get("/.well-known/x402.json", async (request, reply) => {
    const network = process.env.X402_NETWORK ?? "solana-devnet";
    const usdcMint = resolveUsdcMint();
    const baseUrl = `${request.protocol}://${request.headers.host}`;
    const [escrowPda] = deriveEscrowPda(new PublicKey(DONATE_PROJECT_ID));

    reply.type("application/json").send({
      x402Version: 1,
      resources: [
        {
          resource: `${baseUrl}/x402/donate/${DONATE_PROJECT_ID}`,
          type: "http",
          method: "POST",
          description: "Donate USDC (devnet) to an AgentFund campaign via x402. POST returns a 402 challenge; sign the returned unsigned Solana transaction and retry with an X-PAYMENT header to settle.",
          accepts: [
            {
              scheme: "exact",
              network,
              asset: usdcMint,
              payTo: escrowPda.toBase58(),
              maxTimeoutSeconds: 60,
              extra: { projectId: DONATE_PROJECT_ID },
            },
          ],
        },
      ],
      resourceTemplates: [
        {
          resource: `${baseUrl}/x402/donate/{projectId}`,
          type: "http",
          method: "POST",
          description: "Donate to any active AgentFund campaign by its on-chain project ID. Same 402/X-PAYMENT flow as the resource above.",
          accepts: [
            {
              scheme: "exact",
              network,
              asset: usdcMint,
              maxTimeoutSeconds: 60,
            },
          ],
        },
      ],
      provider: {
        name: "AgentFund",
        url: "https://agentfund.online",
      },
    });
  });
}
