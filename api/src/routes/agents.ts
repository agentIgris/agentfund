/**
 * routes/agents.ts — agent directory + registration. POST
 * /agents/register builds the unsigned `register_agent` instruction (the
 * agent signs + submits locally via /tx/send); the resulting on-chain
 * AgentRegistered event is what actually creates the Agent row (see
 * services/indexer.ts) — this route's DB read is best-effort/optimistic
 * only for the metadataUri echoed back.
 */
import type { FastifyInstance } from "fastify";
import { PublicKey } from "@solana/web3.js";
import { prisma } from "../lib/prisma.js";
import { serializeBigInts } from "../lib/serialize.js";
import { requireAuth } from "../middleware/auth.js";
import { buildRegisterAgentIx, buildUnsignedTransactionBase64 } from "../services/solana.js";
import { pinAgentMetadata } from "../services/ipfs.js";
import { agentPubkeyParamSchema, listAgentsQuerySchema, registerAgentBodySchema } from "../schema/agents.js";

export function registerAgentRoutes(app: FastifyInstance): void {
  app.get("/agents", async (request, reply) => {
    const parsed = listAgentsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const { sort, limit, offset } = parsed.data;

    const orderBy =
      sort === "newest"
        ? { createdAt: "desc" as const }
        : sort === "contributed"
          ? { totalContributed: "desc" as const }
          : { reputationScore: "desc" as const };

    const agents = await prisma.agent.findMany({ orderBy, take: limit, skip: offset });
    return reply.send({ agents: serializeBigInts(agents) });
  });

  app.post("/agents/register", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = registerAgentBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const body = parsed.data;
    const owner = new PublicKey(request.agentWallet!);

    const metadataUri =
      body.metadataUri ??
      (await pinAgentMetadata({ name: body.name, description: body.description, avatar: body.avatar }));

    const ix = buildRegisterAgentIx({ owner, metadataUri });
    const unsignedTx = await buildUnsignedTransactionBase64([ix], owner);
    return reply.send({ unsignedTx });
  });

  app.get("/agents/:pubkey", async (request, reply) => {
    const parsed = agentPubkeyParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const agent = await prisma.agent.findUnique({ where: { owner: parsed.data.pubkey } });
    if (!agent) return reply.code(404).send({ error: "not_found" });

    const [projectCount, contributionCount, voteCount] = await Promise.all([
      prisma.project.count({ where: { creator: agent.owner } }),
      prisma.contribution.count({ where: { contributor: agent.owner } }),
      prisma.vote.count({ where: { voter: agent.owner } }),
    ]);

    return reply.send({
      agent: serializeBigInts(agent),
      stats: { projectCount, contributionCount, voteCount },
    });
  });

  app.get("/agents/:pubkey/projects", async (request, reply) => {
    const parsed = agentPubkeyParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const projects = await prisma.project.findMany({
      where: { creator: parsed.data.pubkey },
      orderBy: { createdAt: "desc" },
    });
    return reply.send({ projects: serializeBigInts(projects) });
  });

  app.get("/agents/:pubkey/contributions", async (request, reply) => {
    const parsed = agentPubkeyParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const contributions = await prisma.contribution.findMany({
      where: { contributor: parsed.data.pubkey },
      orderBy: { timestamp: "desc" },
      // A contribution's `amount` is meaningless without knowing which
      // token it's denominated in (SOL lamports vs. USDC micro-units) —
      // include the parent project's tokenMint so callers (the dashboard
      // in particular) can format it as a real currency amount instead of
      // a bare base-unit number.
      include: { project: { select: { tokenMint: true } } },
    });
    return reply.send({
      contributions: serializeBigInts(
        contributions.map(({ project, ...c }) => ({ ...c, tokenMint: project.tokenMint })),
      ),
    });
  });
}
