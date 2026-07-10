/**
 * lib/api.ts — typed fetch client for the AgentFund REST API
 * (base URL from NEXT_PUBLIC_API_URL). Every function throws
 * `ApiError` on network failure or non-2xx responses; callers (page
 * components) catch it and render an empty state — the app must
 * build and render with no API running.
 *
 * Response shapes mirror api/src/routes/*.ts exactly.
 */
import type {
  Agent,
  Contribution,
  Milestone,
  PlatformStats,
  Project,
  SupportedToken,
} from "@agentfund/shared";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

export class ApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    throw new ApiError(
      `Could not reach the AgentFund API at ${API_URL}${path}: ${(err as Error).message}`,
    );
  }

  if (!res.ok) {
    throw new ApiError(`AgentFund API responded ${res.status} for ${path}`, res.status);
  }

  return (await res.json()) as T;
}

function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") qs.set(key, String(value));
  }
  const str = qs.toString();
  return str ? `?${str}` : "";
}

// ─────────────────────────────────────────────────────────────
// Projects
// ─────────────────────────────────────────────────────────────

export interface ListProjectsParams {
  status?: "Active" | "Funded" | "Failed" | "Complete";
  token?: SupportedToken;
  minGoal?: number;
  category?: string;
  sort?: "newest" | "oldest" | "goal" | "raised" | "deadline";
  limit?: number;
  offset?: number;
}

export async function listProjects(params: ListProjectsParams = {}): Promise<Project[]> {
  const data = await apiFetch<{ projects: Project[] }>(`/projects${buildQuery(params)}`);
  return data.projects;
}

export async function getProject(id: string): Promise<Project> {
  const data = await apiFetch<{ project: Project }>(`/projects/${encodeURIComponent(id)}`);
  return data.project;
}

export async function getProjectMilestones(id: string): Promise<Milestone[]> {
  const data = await apiFetch<{ milestones: Milestone[] }>(
    `/projects/${encodeURIComponent(id)}/milestones`,
  );
  return data.milestones;
}

export async function getProjectContributors(id: string): Promise<Contribution[]> {
  const data = await apiFetch<{ contributors: Contribution[] }>(
    `/projects/${encodeURIComponent(id)}/contributors`,
  );
  return data.contributors;
}

// ─────────────────────────────────────────────────────────────
// Agents
// ─────────────────────────────────────────────────────────────

export interface ListAgentsParams {
  sort?: "reputation" | "newest" | "contributed";
  limit?: number;
  offset?: number;
}

export async function listAgents(params: ListAgentsParams = {}): Promise<Agent[]> {
  const data = await apiFetch<{ agents: Agent[] }>(`/agents${buildQuery(params)}`);
  return data.agents;
}

export interface AgentDetail {
  agent: Agent;
  stats: {
    projectCount: number;
    contributionCount: number;
    voteCount: number;
  };
}

export async function getAgent(pubkey: string): Promise<AgentDetail> {
  return apiFetch<AgentDetail>(`/agents/${encodeURIComponent(pubkey)}`);
}

export async function getAgentProjects(pubkey: string): Promise<Project[]> {
  const data = await apiFetch<{ projects: Project[] }>(
    `/agents/${encodeURIComponent(pubkey)}/projects`,
  );
  return data.projects;
}

export async function getAgentContributions(pubkey: string): Promise<Contribution[]> {
  const data = await apiFetch<{ contributions: Contribution[] }>(
    `/agents/${encodeURIComponent(pubkey)}/contributions`,
  );
  return data.contributions;
}

// ─────────────────────────────────────────────────────────────
// Platform stats
// ─────────────────────────────────────────────────────────────

export async function getPlatformStats(): Promise<PlatformStats> {
  return apiFetch<PlatformStats>("/stats");
}
