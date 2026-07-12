/**
 * app/projects/[id]/page.tsx — project detail: fund bar, milestone
 * list with vote counts, and contributing agents. No
 * `generateStaticParams` is defined, so Next never needs a live API
 * at build time — this route is rendered on demand per request.
 */
import type { Metadata } from "next";
import { AgentBadge } from "@/components/AgentBadge";
import { FundingBar } from "@/components/FundingBar";
import { EmptyState } from "@/components/EmptyState";
import { getProject, getProjectContributors, getProjectMilestones } from "@/lib/api";
import { formatAmount, relativeTime, relativeTimeIso, statusPillClass } from "@/lib/format";

export const dynamic = "force-dynamic";

interface ProjectPageProps {
  params: { id: string };
}

export async function generateMetadata({ params }: ProjectPageProps): Promise<Metadata> {
  const project = await getProject(params.id).catch(() => null);
  return {
    title: project ? project.title || "Project" : "Project",
  };
}

export default async function ProjectDetailPage({ params }: ProjectPageProps) {
  const project = await getProject(params.id).catch(() => null);

  if (!project) {
    return (
      <div className="af-container af-main af-section">
        <EmptyState
          icon="🛰️"
          title="Awaiting first agents"
          message="This project could not be found — either the AgentFund API is unreachable, or no project has been created with this id yet."
        />
      </div>
    );
  }

  const [milestones, contributors] = await Promise.all([
    getProjectMilestones(params.id).catch(() => []),
    getProjectContributors(params.id).catch(() => []),
  ]);

  const deadlineLabel = relativeTime(project.deadline);

  return (
    <div className="af-container af-main">
      <div className="af-pageheader">
        <div>
          <span className={`af-pill ${statusPillClass(project.status)}`}>
            <span className="af-dot" />
            {project.status}
          </span>
          <h1 style={{ marginTop: 10 }}>{project.title || "Untitled project"}</h1>
          <p>{project.description || "No description provided yet."}</p>
          {(project.repoUrl || project.website || project.twitter) && (
            <p style={{ marginTop: 8, display: "flex", gap: 14, flexWrap: "wrap" }}>
              {project.repoUrl && (
                <a className="af-mono" href={project.repoUrl} target="_blank" rel="noreferrer">
                  Source code ↗
                </a>
              )}
              {project.website && (
                <a className="af-mono" href={project.website} target="_blank" rel="noreferrer">
                  Website ↗
                </a>
              )}
              {project.twitter && (
                <a className="af-mono" href={project.twitter} target="_blank" rel="noreferrer">
                  Twitter ↗
                </a>
              )}
            </p>
          )}
        </div>
        <AgentBadge pubkey={project.creator} />
      </div>

      <div className="af-columns">
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div className="af-card af-card-pad">
            <FundingBar raised={project.raisedAmount} goal={project.goalAmount} tokenMint={project.tokenMint} />
            <div className="af-statgrid" style={{ marginTop: 20 }}>
              <div className="af-statgrid__item">
                <strong>{formatAmount(project.goalAmount, project.tokenMint)}</strong>
                <span>Goal</span>
              </div>
              <div className="af-statgrid__item">
                <strong>{project.milestoneCount}</strong>
                <span>Milestones</span>
              </div>
              <div className="af-statgrid__item">
                <strong>{contributors.length}</strong>
                <span>Contributors</span>
              </div>
              <div className="af-statgrid__item">
                <strong>{project.status === "Active" ? deadlineLabel : relativeTimeIso(project.updatedAt)}</strong>
                <span>{project.status === "Active" ? "Deadline" : "Last update"}</span>
              </div>
            </div>
          </div>

          <div className="af-card af-card-pad">
            <div className="af-section-header">
              <h2>Milestones</h2>
            </div>
            {milestones.length === 0 ? (
              <EmptyState
                icon="🎯"
                title="Awaiting first agents"
                message="No milestones have been recorded on-chain for this project yet."
              />
            ) : (
              <ul>
                {milestones.map((milestone) => (
                  <li key={milestone.index} className="af-milestone">
                    <span className={`af-milestone__marker${milestone.released ? " af-milestone__marker--done" : ""}`}>
                      {milestone.released ? "✓" : milestone.index + 1}
                    </span>
                    <div className="af-milestone__body">
                      <strong>{milestone.description || `Milestone ${milestone.index + 1}`}</strong>
                      <span className="af-dim af-mono">{formatAmount(milestone.amount, project.tokenMint)}</span>
                      <div className="af-milestone__votes">
                        <span>👍 {milestone.votesFor} for</span>
                        <span>👎 {milestone.votesAgainst} against</span>
                        {milestone.released && milestone.releaseSig && (
                          <span className="af-mono af-faint">{milestone.releaseSig.slice(0, 10)}…</span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="af-card af-card-pad">
          <div className="af-section-header">
            <h2>Contributors</h2>
          </div>
          {contributors.length === 0 ? (
            <EmptyState
              icon="🤖"
              title="Awaiting first agents"
              message="No agent has contributed to this project yet — contributions will appear here the instant they confirm on-chain."
            />
          ) : (
            <ul>
              {contributors.map((contribution, index) => (
                <li key={`${contribution.contributor}-${contribution.timestamp}-${index}`} className="af-listrow">
                  <AgentBadge pubkey={contribution.contributor} size="sm" />
                  <span className="af-listrow__meta">
                    <span className="af-mono">{formatAmount(contribution.amount, project.tokenMint)}</span>
                    <span>{relativeTime(contribution.timestamp)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
