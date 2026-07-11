/**
 * ProjectEvaluatorAgent — spec: "Evaluates project quality and returns
 * trust score". Delegate-able, sync (manifest.async === false).
 *
 * Implementation: "heuristic trust score 0-100 from on-chain-derived
 * facts (creator reputation, goal size sanity, milestone structure, age)
 * with risk_flags[]". This agent does not call an LLM and does not
 * inspect off-chain claims (title/description text) — every input to
 * the score is a fact already indexed from on-chain events by
 * api/src/services/indexer.ts (creator's AgentAccount, the project's
 * ProjectAccount, and its Milestone rows). Read GET /projects/:id,
 * GET /projects/:id/milestones, and GET /agents/:pubkey (the creator).
 *
 * ─────────────────────────────────────────────────────────────
 * SCORING RUBRIC (documented here as the single source of truth — keep
 * in lockstep with the point values below if you change them)
 * ─────────────────────────────────────────────────────────────
 *
 * Score = creatorReputation (0-30) + goalSizeSanity (0-20)
 *       + milestoneStructure (0-25) + age (0-25), clamped to [0, 100].
 *
 * 1. Creator reputation (0-30 pts)
 *    - Creator wallet not found in the agent registry at all: 0 pts,
 *      risk flag "unregistered_creator" (the API requires registration
 *      before create_project, so this should be rare/never in practice
 *      unless the registry read lags the write — flagged defensively).
 *    - Otherwise: min(30, floor(reputationScore / 10)) — reputation
 *      accrues in the platform in increments of 2-50 per
 *      vote/contribution/milestone/goal event (see the reputation
 *      program's on-chain point table), so a reputationScore of 300+ maxes
 *      this bucket.
 *    - reputationScore < 20: additional risk flag "low_reputation_creator".
 *    - projectsCreated === 0 (this is the creator's first-ever project):
 *      risk flag "first_time_creator" (informational; not penalized
 *      beyond the reputation score itself, which is likely low anyway).
 *
 * 2. Goal size sanity (0-20 pts)
 *    Normalizes goalAmount (base units) to human units using the
 *    project's own tokenMint (lamports/1e9 for native SOL, micro-USDC/1e6
 *    for the USDC mint) so the thresholds below are meaningful regardless
 *    of which token the campaign raises in.
 *    - humanGoal <= 0: 0 pts, risk flag "zero_or_invalid_goal".
 *    - humanGoal > 1,000,000: 5 pts, risk flag "unusually_large_goal"
 *      (goals at this scale warrant manual due diligence beyond a
 *      heuristic score).
 *    - otherwise: 20 pts (no additional flag — most legitimate campaigns
 *      land here).
 *
 * 3. Milestone structure (0-25 pts)
 *    - milestoneCount === 0: 0 pts, risk flag "no_milestones_all_or_nothing"
 *      (100% of funds releasable with no staged accountability).
 *    - milestoneCount === 1: 10 pts, risk flag "single_milestone_lump_sum".
 *    - milestoneCount in [2, 4]: 20 pts.
 *    - milestoneCount >= 5: 25 pts.
 *    - Additionally, if the sum of fetched milestone amounts differs from
 *      the project's goalAmount by more than 1%: -5 pts (floor 0), risk
 *      flag "milestone_amounts_mismatch_goal".
 *
 * 4. Age (0-25 pts) — how long the project has existed on-chain, as a
 *    proxy for "hasn't already been reported/refunded/abandoned in its
 *    first hours":
 *    - ageDays < 1: 5 pts, risk flag "recently_created_project".
 *    - ageDays in [1, 7): 15 pts.
 *    - ageDays >= 7: 25 pts.
 *    Independently of the point total:
 *    - deadline already passed and status still "Active": risk flag
 *      "deadline_passed_still_active" (should have transitioned to
 *      Funded/Failed — stale read or indexer lag worth surfacing).
 *    - (deadline - createdAt) < 3 days: risk flag "short_deadline"
 *      (very little time for other agents to evaluate before it closes).
 *
 * `on_chain_verified` is true iff the project was found AND the
 * indexed `milestoneCount` on the ProjectAccount matches the number of
 * Milestone rows actually returned by GET /projects/:id/milestones —
 * i.e. the read model is internally consistent, not just present.
 *
 * `recommendation` buckets the final score: >=80 "strong_fund",
 * >=60 "fund", >=35 "caution", else "avoid".
 */
import { NATIVE_SOL_MINT, resolveUsdcMint } from "@agentfund/shared";
import { api, ApiError } from "../api-client.js";
import { config } from "../config.js";
import type { ProjectEvaluatorAgentInput, ProjectEvaluatorAgentOutput } from "../schemas.js";
import type { AgentDefinition } from "../types.js";
import { projectEvaluatorAgentInputSchema } from "../schemas.js";
import { projectEvaluatorAgentManifest } from "../manifests/agents.js";

interface ProjectApiShape {
  id: string;
  creator: string;
  goalAmount: number;
  tokenMint: string;
  raisedAmount: number;
  deadline: number; // unix seconds
  status: "Active" | "Funded" | "Failed" | "Complete";
  milestoneCount: number;
  createdAt: string; // ISO datetime
}

interface MilestoneApiShape {
  index: number;
  amount: number;
}

interface AgentApiShape {
  owner: string;
  reputationScore: number;
  projectsCreated: number;
}

const SECONDS_PER_DAY = 86_400;
const LARGE_GOAL_THRESHOLD_HUMAN_UNITS = 1_000_000;
const MILESTONE_SUM_TOLERANCE_RATIO = 0.01;
const SHORT_DEADLINE_DAYS = 3;

function humanGoal(project: ProjectApiShape): number {
  const usdcMint = resolveUsdcMint({ SOLANA_CLUSTER: config.solana.cluster });
  if (project.tokenMint === NATIVE_SOL_MINT) return project.goalAmount / 1e9;
  if (project.tokenMint === usdcMint) return project.goalAmount / 1e6;
  // Unknown mint (shouldn't happen on this platform) — treat as already human-scale.
  return project.goalAmount;
}

function scoreCreatorReputation(agent: AgentApiShape | undefined, riskFlags: string[]): number {
  if (!agent) {
    riskFlags.push("unregistered_creator");
    return 0;
  }
  if (agent.reputationScore < 20) riskFlags.push("low_reputation_creator");
  if (agent.projectsCreated === 0) riskFlags.push("first_time_creator");
  return Math.min(30, Math.floor(agent.reputationScore / 10));
}

function scoreGoalSizeSanity(project: ProjectApiShape, riskFlags: string[]): number {
  const goal = humanGoal(project);
  if (goal <= 0) {
    riskFlags.push("zero_or_invalid_goal");
    return 0;
  }
  if (goal > LARGE_GOAL_THRESHOLD_HUMAN_UNITS) {
    riskFlags.push("unusually_large_goal");
    return 5;
  }
  return 20;
}

function scoreMilestoneStructure(
  project: ProjectApiShape,
  milestones: MilestoneApiShape[],
  riskFlags: string[],
): number {
  const count = project.milestoneCount;
  let points: number;
  if (count === 0) {
    riskFlags.push("no_milestones_all_or_nothing");
    points = 0;
  } else if (count === 1) {
    riskFlags.push("single_milestone_lump_sum");
    points = 10;
  } else if (count <= 4) {
    points = 20;
  } else {
    points = 25;
  }

  const milestoneSum = milestones.reduce((sum, m) => sum + m.amount, 0);
  if (project.goalAmount > 0 && milestones.length > 0) {
    const deviation = Math.abs(milestoneSum - project.goalAmount) / project.goalAmount;
    if (deviation > MILESTONE_SUM_TOLERANCE_RATIO) {
      riskFlags.push("milestone_amounts_mismatch_goal");
      points = Math.max(0, points - 5);
    }
  }

  return points;
}

function scoreAge(project: ProjectApiShape, riskFlags: string[]): number {
  const nowSeconds = Date.now() / 1000;
  const createdAtSeconds = new Date(project.createdAt).getTime() / 1000;
  const ageDays = (nowSeconds - createdAtSeconds) / SECONDS_PER_DAY;

  let points: number;
  if (ageDays < 1) {
    riskFlags.push("recently_created_project");
    points = 5;
  } else if (ageDays < 7) {
    points = 15;
  } else {
    points = 25;
  }

  if (project.deadline < nowSeconds && project.status === "Active") {
    riskFlags.push("deadline_passed_still_active");
  }
  const campaignLengthDays = (project.deadline - createdAtSeconds) / SECONDS_PER_DAY;
  if (campaignLengthDays < SHORT_DEADLINE_DAYS) {
    riskFlags.push("short_deadline");
  }

  return points;
}

function recommendationFor(score: number): ProjectEvaluatorAgentOutput["recommendation"] {
  if (score >= 80) return "strong_fund";
  if (score >= 60) return "fund";
  if (score >= 35) return "caution";
  return "avoid";
}

async function execute(input: ProjectEvaluatorAgentInput): Promise<ProjectEvaluatorAgentOutput> {
  let project: ProjectApiShape;
  try {
    const res = await api.get<{ project: ProjectApiShape }>(`/projects/${input.project_id}`);
    project = res.project;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return {
        score: 0,
        recommendation: "avoid",
        risk_flags: ["project_not_found"],
        on_chain_verified: false,
      };
    }
    throw err;
  }

  const [milestonesRes, agentRes] = await Promise.all([
    api.get<{ milestones: MilestoneApiShape[] }>(`/projects/${input.project_id}/milestones`),
    api
      .get<{ agent: AgentApiShape }>(`/agents/${project.creator}`)
      .then((r) => r.agent)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) return undefined;
        throw err;
      }),
  ]);
  const milestones = milestonesRes.milestones;

  const riskFlags: string[] = [];
  const score = Math.max(
    0,
    Math.min(
      100,
      scoreCreatorReputation(agentRes, riskFlags) +
        scoreGoalSizeSanity(project, riskFlags) +
        scoreMilestoneStructure(project, milestones, riskFlags) +
        scoreAge(project, riskFlags),
    ),
  );

  const onChainVerified = milestones.length === project.milestoneCount;
  if (!onChainVerified) riskFlags.push("milestone_count_mismatch");

  return {
    score,
    recommendation: recommendationFor(score),
    risk_flags: riskFlags,
    on_chain_verified: onChainVerified,
  };
}

export const projectEvaluatorAgent: AgentDefinition<typeof projectEvaluatorAgentInputSchema> = {
  manifest: projectEvaluatorAgentManifest,
  inputSchema: projectEvaluatorAgentInputSchema,
  execute,
};
