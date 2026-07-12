/**
 * services/indexer.ts — the on-chain event → DB → Redis pipeline. Takes
 * already-parsed Anchor events (from services/helius.ts), upserts the
 * corresponding Prisma rows, and publishes the matching WsServerEvent
 * shape (see @agentfund/shared's `Ws*Event` types) to the Redis broker
 * so both the WS server and the SSE stream fan it out. Idempotent:
 * every (signature, eventName) pair is recorded in `IndexedEvent` and
 * re-deliveries from Helius are skipped.
 */
import { ProjectStatus } from "@agentfund/shared";
import { prisma } from "../lib/prisma.js";
import { broker } from "./broker.js";
import { resolveMetadataJson, type ProjectMetadata } from "./ipfs.js";
import { applyReputationEvent } from "./reputationWriter.js";

/**
 * Structural subset of pino.Logger (and Fastify's FastifyBaseLogger, which
 * doesn't structurally satisfy the full pino.Logger interface) — indexEvent
 * only ever calls `.error(obj, msg)`.
 */
export interface MinimalErrorLogger {
  error(obj: unknown, msg?: string): void;
}

export type ProgramName = "agent_registry" | "escrow" | "reputation";

export interface RawProgramEvent<T = Record<string, unknown>> {
  program: ProgramName;
  /** Anchor event struct name, e.g. "ProjectCreated", "ContributionMade". */
  eventName: string;
  signature: string;
  slot: number;
  data: T;
}

function toDate(unixSeconds: number | string | bigint): Date {
  return new Date(Number(unixSeconds) * 1000);
}

/**
 * Backfills milestone display descriptions from project metadata onto
 * whatever milestone rows already exist. `updateMany` is a no-op for
 * indexes without a row yet — escrow events create those rows later, and
 * a metadata refresh (ProjectMetadataUpdated replay) fills them in on
 * re-seed.
 */
async function applyMilestoneDescriptions(
  projectId: string,
  meta: ProjectMetadata,
): Promise<void> {
  for (const m of meta.milestones ?? []) {
    await prisma.milestone.updateMany({
      where: { projectId, index: m.index },
      data: { description: m.description },
    });
  }
}

/**
 * Processes one parsed on-chain event: records it (idempotently), then
 * upserts Prisma state and publishes the corresponding WS/SSE event.
 * Unknown (program, eventName) pairs are recorded but otherwise ignored.
 * Returns true when the event was newly applied, false on a dedup skip.
 */
export async function indexEvent(
  event: RawProgramEvent,
  logger?: MinimalErrorLogger,
): Promise<boolean> {
  const existing = await prisma.indexedEvent.findUnique({
    where: { signature_eventName: { signature: event.signature, eventName: event.eventName } },
  });
  if (existing) return false; // already processed — Helius may redeliver

  await prisma.indexedEvent.create({
    data: {
      program: event.program,
      eventName: event.eventName,
      signature: event.signature,
      slot: BigInt(event.slot),
      payload: event.data as never,
    },
  });

  try {
    await dispatch(event);
  } catch (err) {
    logger?.error({ err, event }, "indexer: failed to apply event to read model");
    // Un-mark the event so a Helius redelivery (or replay) can retry it —
    // otherwise a transient dispatch failure would leave the signature
    // permanently recorded as processed with no read-model row behind it.
    await prisma.indexedEvent
      .delete({
        where: { signature_eventName: { signature: event.signature, eventName: event.eventName } },
      })
      .catch(() => undefined);
    throw err;
  }
  return true;
}

async function dispatch(event: RawProgramEvent): Promise<void> {
  const { program, eventName, data, signature } = event;

  if (program === "agent_registry" && eventName === "AgentRegistered") {
    const d = data as { owner: string; metadataUri: string };
    await prisma.agent.upsert({
      where: { owner: d.owner },
      create: { owner: d.owner, metadataUri: d.metadataUri },
      update: { metadataUri: d.metadataUri },
    });
    return;
  }

  if (program === "agent_registry" && eventName === "ProjectCreated") {
    const d = data as {
      project: string;
      creator: string;
      projectIndex: number;
      ipfsHash: string;
      goalAmount: number | string;
      tokenMint: string;
      deadline: number;
      milestoneCount: number;
      timestamp: number;
    };

    let meta: ProjectMetadata = { title: d.project, description: "" };
    try {
      meta = await resolveMetadataJson<ProjectMetadata>(d.ipfsHash);
    } catch {
      // Metadata unavailable yet (IPFS propagation lag) — fall back to a
      // placeholder; a future re-index / manual refresh can backfill it.
    }

    await prisma.agent.upsert({
      where: { owner: d.creator },
      create: { owner: d.creator, metadataUri: "", projectsCreated: d.projectIndex + 1 },
      update: { projectsCreated: d.projectIndex + 1 },
    });

    await prisma.project.upsert({
      where: { id: d.project },
      create: {
        id: d.project,
        creator: d.creator,
        projectIndex: d.projectIndex,
        ipfsHash: d.ipfsHash,
        title: meta.title,
        description: meta.description,
        image: meta.image,
        category: meta.category,
        repoUrl: meta.repoUrl,
        website: meta.website,
        twitter: meta.twitter,
        goalAmount: BigInt(d.goalAmount),
        tokenMint: d.tokenMint,
        raisedAmount: 0n,
        deadline: BigInt(d.deadline),
        status: ProjectStatus.Active,
        milestoneCount: d.milestoneCount,
      },
      update: {},
    });

    await applyMilestoneDescriptions(d.project, meta);

    await broker.publish("projects", {
      type: "project.created",
      data: {
        id: d.project,
        creator: d.creator,
        goal: Number(d.goalAmount),
        title: meta.title,
        tokenMint: d.tokenMint,
        deadline: d.deadline,
      },
    });
    return;
  }

  if (program === "agent_registry" && eventName === "ProjectStatusChanged") {
    const d = data as { project: string; newStatus: keyof typeof ProjectStatus };
    await prisma.project.update({
      where: { id: d.project },
      data: { status: d.newStatus as ProjectStatus },
    });
    return;
  }

  if (program === "agent_registry" && eventName === "ProjectMetadataUpdated") {
    const d = data as {
      project: string;
      oldIpfsHash: string;
      newIpfsHash: string;
      changedBy: string;
      timestamp: number;
    };

    // Re-resolve display metadata from the new reference. Unlike
    // ProjectCreated there is no propagation-lag fallback: an explicit
    // metadata update whose content can't be fetched should fail loudly
    // (indexEvent un-marks the event so a redelivery retries), never
    // silently blank out the project's display fields.
    const meta = await resolveMetadataJson<ProjectMetadata>(d.newIpfsHash);

    await prisma.project.update({
      where: { id: d.project },
      data: {
        ipfsHash: d.newIpfsHash,
        title: meta.title,
        description: meta.description,
        image: meta.image,
        category: meta.category,
        repoUrl: meta.repoUrl,
        website: meta.website,
        twitter: meta.twitter,
      },
    });

    await applyMilestoneDescriptions(d.project, meta);

    await broker.publish("projects", {
      type: "project.updated",
      data: { id: d.project, title: meta.title, changedBy: d.changedBy },
    });
    return;
  }

  if (program === "escrow" && eventName === "ContributionMade") {
    const d = data as {
      project: string;
      contributor: string;
      amount: number | string;
      totalDeposited: number | string;
      timestamp: number;
    };

    await prisma.contribution.upsert({
      where: { sig: signature },
      create: {
        contributor: d.contributor,
        projectId: d.project,
        amount: BigInt(d.amount),
        timestamp: toDate(d.timestamp),
        sig: signature,
      },
      update: {},
    });

    // Reputation write path (REVIEW_FINDINGS.md #10): +5 to the contributor
    // for every confirmed contribution. Fire-and-forget — applyReputationEvent
    // never throws, but `.catch` is defense-in-depth (matches the
    // fire-and-forget pattern in routes/webhooks.ts's startWebhookDispatcher).
    void applyReputationEvent({ agentWallet: d.contributor, reason: "ContributionMade" }).catch(
      () => undefined,
    );

    const project = await prisma.project.update({
      where: { id: d.project },
      data: { raisedAmount: BigInt(d.totalDeposited) },
    });

    await prisma.agent.update({
      where: { owner: d.contributor },
      data: { totalContributed: { increment: BigInt(d.amount) } },
    }).catch(() => undefined); // contributor may not have a registered Agent row yet

    await broker.publish("contributions", {
      type: "contribution.made",
      data: {
        project: d.project,
        contributor: d.contributor,
        amount: Number(d.amount),
        sig: signature,
      },
    });

    if (BigInt(project.raisedAmount) >= BigInt(project.goalAmount) && project.status === ProjectStatus.Active) {
      await prisma.project.update({ where: { id: d.project }, data: { status: ProjectStatus.Funded } });
      await broker.publish("projects", {
        type: "goal.reached",
        data: { project: d.project, totalRaised: Number(project.raisedAmount) },
      });

      // Reputation write path: +50 to the project's creator once its goal is
      // fully reached (project completion, creator side of the point table).
      void applyReputationEvent({ agentWallet: project.creator, reason: "GoalReached" }).catch(
        () => undefined,
      );
    }
    return;
  }

  if (program === "escrow" && eventName === "VoteCast") {
    const d = data as {
      project: string;
      voter: string;
      milestoneIndex: number;
      support: boolean;
      weight: number | string;
      timestamp: number;
    };

    await prisma.vote.upsert({
      where: { voter_projectId_milestoneIndex: { voter: d.voter, projectId: d.project, milestoneIndex: d.milestoneIndex } },
      create: {
        voter: d.voter,
        projectId: d.project,
        milestoneIndex: d.milestoneIndex,
        support: d.support,
        weight: BigInt(d.weight),
        timestamp: toDate(d.timestamp),
        sig: signature,
      },
      update: { sig: signature },
    });

    await prisma.milestone.upsert({
      where: { projectId_index: { projectId: d.project, index: d.milestoneIndex } },
      create: {
        projectId: d.project,
        index: d.milestoneIndex,
        amount: 0n,
        votesFor: d.support ? 1 : 0,
        votesAgainst: d.support ? 0 : 1,
      },
      update: d.support ? { votesFor: { increment: 1 } } : { votesAgainst: { increment: 1 } },
    });

    // Reputation write path: +2 to the voter per governance vote cast.
    void applyReputationEvent({ agentWallet: d.voter, reason: "VoteCast" }).catch(() => undefined);

    await broker.publish("votes", {
      type: "vote.cast",
      data: { project: d.project, voter: d.voter, support: d.support, sig: signature },
    });
    return;
  }

  if (program === "escrow" && eventName === "MilestoneReleased") {
    const d = data as {
      project: string;
      milestoneIndex: number;
      amount: number | string;
      creator: string;
      timestamp: number;
    };

    // Reputation write path: +15 to the creator per released milestone.
    void applyReputationEvent({ agentWallet: d.creator, reason: "MilestoneReleased" }).catch(
      () => undefined,
    );

    await prisma.milestone.upsert({
      where: { projectId_index: { projectId: d.project, index: d.milestoneIndex } },
      create: {
        projectId: d.project,
        index: d.milestoneIndex,
        amount: BigInt(d.amount),
        released: true,
        releaseSig: signature,
      },
      update: { released: true, releaseSig: signature, amount: BigInt(d.amount) },
    });

    await broker.publish(`project:${d.project}`, {
      type: "milestone.released",
      data: { project: d.project, milestone: d.milestoneIndex, sig: signature },
    });
    return;
  }

  if (program === "escrow" && eventName === "Refunded") {
    const d = data as { project: string; timestamp: number };
    // Snapshot the pre-update status so the creator's -20 lands exactly once
    // (refund events fire once per contributor; only the first one flips the
    // project to Failed).
    const prev = await prisma.project
      .findUnique({ where: { id: d.project }, select: { creator: true, status: true } })
      .catch(() => null);
    await prisma.project.update({ where: { id: d.project }, data: { status: ProjectStatus.Failed } }).catch(() => undefined);
    if (prev && prev.status !== ProjectStatus.Failed) {
      void applyReputationEvent({ agentWallet: prev.creator, reason: "ProjectRefunded" }).catch(
        () => undefined,
      );
    }
    await broker.publish(`project:${d.project}`, {
      type: "project.status_changed" as never,
      data: { project: d.project, status: "Failed" },
    });
    return;
  }

  if (program === "reputation" && (eventName === "ReputationInitialized" || eventName === "ReputationUpdated")) {
    const d = data as { agent: string; score?: number; newScore?: number };
    const score = d.newScore ?? d.score ?? 0;
    await prisma.agent
      .update({ where: { owner: d.agent }, data: { reputationScore: BigInt(score) } })
      .catch(() => undefined);
    return;
  }

  // Unknown event — already persisted to IndexedEvent for audit; nothing more to do.
}
