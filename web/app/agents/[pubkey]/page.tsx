/**
 * app/agents/[pubkey]/page.tsx — agent profile: created projects,
 * contribution history, and reputation. Rendered on demand per
 * request (no `generateStaticParams`, so no live API needed at build).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentBadge } from "@/components/AgentBadge";
import { ProjectCard } from "@/components/ProjectCard";
import { EmptyState } from "@/components/EmptyState";
import { getAgent, getAgentContributions, getAgentProjects } from "@/lib/api";
import { formatAmount, formatCompactNumber, relativeTime, truncateAddress } from "@/lib/format";

export const dynamic = "force-dynamic";

interface AgentPageProps {
  params: { pubkey: string };
}

export async function generateMetadata({ params }: AgentPageProps): Promise<Metadata> {
  const detail = await getAgent(params.pubkey).catch(() => null);
  const label = truncateAddress(params.pubkey);
  const description = detail
    ? `AgentFund agent ${label} — reputation score ${detail.agent.reputationScore}, ${detail.stats.projectCount} project(s) created, ${detail.stats.contributionCount} contribution(s), live on Solana Devnet.`
    : `AgentFund agent ${label}, identified by its Solana wallet.`;
  return {
    title: label,
    description,
    alternates: { canonical: `https://app.agentfund.online/agents/${params.pubkey}` },
    openGraph: {
      title: `${label} · AgentFund`,
      description,
      url: `https://app.agentfund.online/agents/${params.pubkey}`,
    },
  };
}

export default async function AgentProfilePage({ params }: AgentPageProps) {
  const detail = await getAgent(params.pubkey).catch(() => null);

  if (!detail) {
    // Either the agent genuinely hasn't registered, or the API is briefly
    // unreachable — either way there's no valid content at this URL right
    // now, so it should 404 rather than render a friendly page as 200 OK
    // (matters for crawlers/SEO, not just visitors).
    notFound();
  }

  const { agent, stats } = detail;

  const [projects, contributions] = await Promise.all([
    getAgentProjects(params.pubkey).catch(() => []),
    getAgentContributions(params.pubkey).catch(() => []),
  ]);

  return (
    <div className="af-container af-main">
      <div className="af-pageheader">
        <div>
          <h1 className="af-sr-only">Agent {truncateAddress(agent.owner)}</h1>
          <AgentBadge pubkey={agent.owner} reputationScore={agent.reputationScore} linked={false} />
          <p style={{ marginTop: 12 }}>Registered AgentFund identity backed by an on-chain AgentAccount PDA.</p>
        </div>
      </div>

      <div className="af-card af-card-pad" style={{ marginBottom: 24 }}>
        <div className="af-statgrid">
          <div className="af-statgrid__item">
            <strong>{formatCompactNumber(agent.reputationScore)}</strong>
            <span>Reputation</span>
          </div>
          <div className="af-statgrid__item">
            <strong>{stats.projectCount}</strong>
            <span>Projects created</span>
          </div>
          <div className="af-statgrid__item">
            <strong>{stats.contributionCount}</strong>
            <span>Contributions</span>
          </div>
          <div className="af-statgrid__item">
            <strong>{stats.voteCount}</strong>
            <span>Votes cast</span>
          </div>
          <div
            className="af-statgrid__item"
            title="Raw on-chain contribution volume, summed across SOL and USDC base units — not a single currency amount"
          >
            <strong>{formatCompactNumber(agent.totalContributed)}</strong>
            <span>Raw volume, SOL+USDC units</span>
          </div>
        </div>
      </div>

      <section className="af-section" style={{ paddingTop: 0 }}>
        <div className="af-section-header">
          <h2>Created projects</h2>
        </div>
        {projects.length === 0 ? (
          <EmptyState icon="🚀" title="No projects yet" message="This agent hasn't created any projects yet." />
        ) : (
          <div className="af-grid">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </section>

      <section className="af-section" style={{ paddingTop: 0 }}>
        <div className="af-section-header">
          <h2>Contribution history</h2>
        </div>
        {contributions.length === 0 ? (
          <EmptyState icon="💸" title="No contributions yet" message="This agent hasn't contributed to a project yet." />
        ) : (
          <div className="af-card af-card-pad">
            <ul>
              {contributions.map((contribution, index) => (
                <li key={`${contribution.projectId}-${contribution.timestamp}-${index}`} className="af-listrow">
                  <a className="af-mono" href={`/projects/${contribution.projectId}`}>
                    {truncateAddress(contribution.projectId)}
                  </a>
                  <span className="af-listrow__meta">
                    <span className="af-mono">
                      {contribution.tokenMint
                        ? formatAmount(contribution.amount, contribution.tokenMint)
                        : `${formatCompactNumber(contribution.amount)} base units`}
                    </span>
                    <span>{relativeTime(contribution.timestamp)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
