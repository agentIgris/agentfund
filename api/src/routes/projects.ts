/**
 * routes/projects.ts — project listing/detail/creation + the
 * project-scoped contribute/vote convenience endpoints. Every endpoint
 * that results in an on-chain state change returns an *unsigned*
 * transaction (base64) for the calling agent to sign locally and submit
 * via POST /tx/send — the API never holds agent private keys.
 */
import type { FastifyInstance } from "fastify";
import { PublicKey } from "@solana/web3.js";
import { NATIVE_SOL_MINT, resolveUsdcMint } from "@agentfund/shared";
import { prisma } from "../lib/prisma.js";
import { serializeBigInts } from "../lib/serialize.js";
import { requireAuth } from "../middleware/auth.js";
import {
  buildContributeIx,
  buildCreateProjectIx,
  buildUnsignedTransactionBase64,
  buildVoteMilestoneIx,
  deriveProjectPda,
} from "../services/solana.js";
import { pinProjectMetadata } from "../services/ipfs.js";
import {
  contributeBodySchema,
  createProjectBodySchema,
  listProjectsQuerySchema,
  projectIdParamSchema,
  voteBodySchema,
} from "../schema/projects.js";

function tokenToMint(token: "SOL" | "USDC"): string {
  return token === "SOL" ? NATIVE_SOL_MINT : resolveUsdcMint();
}

/**
 * A project with `title === ""` never got a real title resolved from its
 * metadata reference (see indexer.ts's ProjectCreated/ProjectMetadataUpdated
 * handlers) — it's not a legitimate campaign, just broken/incomplete
 * on-chain state (a lagging metadata fetch, a test project created by
 * bypassing the API, a bad on-chain `ipfs_hash`, etc). Every public-facing
 * route excludes these by default so the dashboard (or any other consumer
 * of this API) can never render an untitled/broken project card.
 */
const VISIBLE_PROJECT_WHERE = { title: { not: "" } };

export function registerProjectRoutes(app: FastifyInstance): void {
  app.get("/projects", async (request, reply) => {
    const parsed = listProjectsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const { status, token, minGoal, category, sort, limit, offset, includeHidden } = parsed.data;

    const orderBy =
      sort === "oldest"
        ? { createdAt: "asc" as const }
        : sort === "goal"
          ? { goalAmount: "desc" as const }
          : sort === "raised"
            ? { raisedAmount: "desc" as const }
            : sort === "deadline"
              ? { deadline: "asc" as const }
              : { createdAt: "desc" as const };

    const projects = await prisma.project.findMany({
      where: {
        status,
        tokenMint: token ? tokenToMint(token) : undefined,
        goalAmount: minGoal ? { gte: BigInt(minGoal) } : undefined,
        category: category ?? undefined,
        ...(includeHidden ? {} : VISIBLE_PROJECT_WHERE),
      },
      orderBy,
      take: limit,
      skip: offset,
    });

    return reply.send({ projects: serializeBigInts(projects) });
  });

  app.post("/projects", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createProjectBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const body = parsed.data;
    const creator = request.agentWallet!;

    const agent = await prisma.agent.findUnique({ where: { owner: creator } });
    if (!agent) {
      return reply.code(409).send({
        error: "agent_not_registered",
        message: "Register the calling wallet via POST /agents/register (or /tx/build/register_agent) before creating a project.",
      });
    }

    const ipfsHash = await pinProjectMetadata({
      title: body.title,
      description: body.description,
      image: body.image,
      category: body.category,
      repoUrl: body.repoUrl,
      website: body.website,
      twitter: body.twitter,
    });

    const creatorPk = new PublicKey(creator);
    const projectIndex = agent.projectsCreated;
    const [projectPda] = deriveProjectPda(creatorPk, projectIndex);
    const tokenMint = tokenToMint(body.token);

    const ix = buildCreateProjectIx({
      creator: creatorPk,
      projectIndex,
      ipfsHash,
      goalAmount: body.goalAmount,
      tokenMint: new PublicKey(tokenMint),
      deadline: body.deadline,
      milestoneCount: body.milestones.length,
    });

    const unsignedTx = await buildUnsignedTransactionBase64([ix], creatorPk);

    return reply.send({ projectId: projectPda.toBase58(), unsignedTx });
  });

  app.get("/projects/:id", async (request, reply) => {
    const parsed = projectIdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const project = await prisma.project.findUnique({ where: { id: parsed.data.id } });
    // Same rule as the list route: a broken/untitled project (see
    // VISIBLE_PROJECT_WHERE above) is treated as not found by every public
    // route, including direct-by-id lookups — there is no legitimate way
    // for a human-facing page to link to one in the first place, so a 404
    // here just means "this isn't a real project" rather than hiding an
    // error.
    if (!project || project.title === "") return reply.code(404).send({ error: "not_found" });
    return reply.send({ project: serializeBigInts(project) });
  });

  app.get("/projects/:id/milestones", async (request, reply) => {
    const parsed = projectIdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const milestones = await prisma.milestone.findMany({
      where: { projectId: parsed.data.id },
      orderBy: { index: "asc" },
    });
    return reply.send({ milestones: serializeBigInts(milestones) });
  });

  app.post("/projects/:id/contribute", { preHandler: requireAuth }, async (request, reply) => {
    const params = projectIdParamSchema.safeParse(request.params);
    const parsed = contributeBodySchema.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    const project = await prisma.project.findUnique({ where: { id: params.data.id } });
    if (!project) return reply.code(404).send({ error: "not_found" });

    const contributor = new PublicKey(request.agentWallet!);
    const ix = buildContributeIx({
      contributor,
      project: new PublicKey(project.id),
      tokenMint: new PublicKey(project.tokenMint),
      amount: parsed.data.amount,
    });
    const unsignedTx = await buildUnsignedTransactionBase64([ix], contributor);
    return reply.send({ unsignedTx });
  });

  app.post("/projects/:id/vote", { preHandler: requireAuth }, async (request, reply) => {
    const params = projectIdParamSchema.safeParse(request.params);
    const parsed = voteBodySchema.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    const project = await prisma.project.findUnique({ where: { id: params.data.id } });
    if (!project) return reply.code(404).send({ error: "not_found" });

    const voter = new PublicKey(request.agentWallet!);
    const ix = buildVoteMilestoneIx({
      voter,
      project: new PublicKey(project.id),
      milestoneIndex: parsed.data.milestoneIndex,
      support: parsed.data.support,
    });
    const unsignedTx = await buildUnsignedTransactionBase64([ix], voter);
    return reply.send({ unsignedTx });
  });

  app.get("/projects/:id/contributors", async (request, reply) => {
    const parsed = projectIdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const contributions = await prisma.contribution.findMany({
      where: { projectId: parsed.data.id },
      orderBy: { amount: "desc" },
    });
    return reply.send({ contributors: serializeBigInts(contributions) });
  });
}
