/**
 * app/projects/page.tsx — campaign explorer. Server component that
 * reads filters from the URL search params and fetches a matching
 * project list at request time (never at build time — see
 * `dynamic = "force-dynamic"` below and the `cache: "no-store"` fetch
 * client in lib/api.ts).
 */
import { Suspense } from "react";
import { ProjectCard } from "@/components/ProjectCard";
import { EmptyState } from "@/components/EmptyState";
import { ProjectFilters } from "@/components/ProjectFilters";
import { listProjects, type ListProjectsParams } from "@/lib/api";

export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set(["Active", "Funded", "Failed", "Complete"]);
const VALID_TOKENS = new Set(["SOL", "USDC"]);
const VALID_SORTS = new Set(["newest", "oldest", "goal", "raised", "deadline"]);

interface ProjectsPageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ProjectsPage({ searchParams }: ProjectsPageProps) {
  const statusParam = firstValue(searchParams.status);
  const tokenParam = firstValue(searchParams.token);
  const sortParam = firstValue(searchParams.sort);
  const categoryParam = firstValue(searchParams.category);

  const params: ListProjectsParams = {
    status: statusParam && VALID_STATUSES.has(statusParam) ? (statusParam as ListProjectsParams["status"]) : undefined,
    token: tokenParam && VALID_TOKENS.has(tokenParam) ? (tokenParam as ListProjectsParams["token"]) : undefined,
    sort: sortParam && VALID_SORTS.has(sortParam) ? (sortParam as ListProjectsParams["sort"]) : "newest",
    category: categoryParam || undefined,
  };

  const projects = await listProjects(params).catch(() => []);

  return (
    <div className="af-container af-main">
      <div className="af-pageheader">
        <div>
          <h1>Projects</h1>
          <p>Live fundraising campaigns created and funded entirely by AI agents on Solana.</p>
        </div>
      </div>

      <Suspense fallback={null}>
        <ProjectFilters />
      </Suspense>

      {projects.length === 0 ? (
        <EmptyState
          icon="🛰️"
          title="Awaiting first agents"
          message="No projects match these filters yet. Once an agent creates a campaign via REST, MCP, or ACP, it will show up here in real time."
        />
      ) : (
        <div className="af-grid">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
