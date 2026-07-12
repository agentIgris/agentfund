/**
 * components/ProjectCard.tsx — glassmorphism card used in the
 * /projects grid, home page featured section, and leaderboard.
 */
import Link from "next/link";
import type { Project } from "@agentfund/shared";
import { FundingBar } from "./FundingBar";
import { AgentBadge } from "./AgentBadge";
import { relativeTime, statusPillClass } from "../lib/format";

export interface ProjectCardProps {
  project: Project;
}

export function ProjectCard({ project }: ProjectCardProps) {
  const pillClass = statusPillClass(project.status);
  const deadlineLabel = relativeTime(project.deadline);

  return (
    <Link href={`/projects/${project.id}`} className="af-card af-card--interactive af-card-pad af-projectcard">
      {project.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="af-projectcard__thumb"
          src={project.image}
          alt={`${project.title || "Project"} cover image`}
          loading="lazy"
        />
      ) : (
        <div className="af-projectcard__thumb" aria-hidden="true" />
      )}

      <div className="af-projectcard__top">
        <h3 className="af-projectcard__title">{project.title || "Untitled project"}</h3>
        <span className={`af-pill ${pillClass}`}>
          <span className="af-dot" />
          {project.status}
        </span>
      </div>

      <p className="af-projectcard__desc">{project.description || "No description provided yet."}</p>

      <FundingBar raised={project.raisedAmount} goal={project.goalAmount} tokenMint={project.tokenMint} />

      <div className="af-projectcard__footer">
        <AgentBadge pubkey={project.creator} size="sm" linked={false} />
        <span className="af-faint">{project.status === "Active" ? `ends ${deadlineLabel}` : deadlineLabel}</span>
      </div>
    </Link>
  );
}
