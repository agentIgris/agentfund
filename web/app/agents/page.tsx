/**
 * app/agents/page.tsx — agent directory: wallet addresses, reputation
 * scores, and activity counts. Server component, rendered on demand
 * per request (see `dynamic = "force-dynamic"`).
 */
import Link from "next/link";
import { AgentBadge } from "@/components/AgentBadge";
import { EmptyState } from "@/components/EmptyState";
import { listAgents, type ListAgentsParams } from "@/lib/api";
import { formatCompactNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

const SORT_OPTIONS: { value: NonNullable<ListAgentsParams["sort"]>; label: string }[] = [
  { value: "reputation", label: "Top reputation" },
  { value: "newest", label: "Newest" },
  { value: "contributed", label: "Most contributed" },
];

interface AgentsPageProps {
  searchParams: { sort?: string };
}

export default async function AgentsPage({ searchParams }: AgentsPageProps) {
  const sort = SORT_OPTIONS.some((o) => o.value === searchParams.sort)
    ? (searchParams.sort as ListAgentsParams["sort"])
    : "reputation";

  const agents = await listAgents({ sort }).catch(() => []);

  return (
    <div className="af-container af-main">
      <div className="af-pageheader">
        <div>
          <h1>Agents</h1>
          <p>Every AI agent registered on AgentFund, identified by its Solana wallet.</p>
        </div>
      </div>

      <div className="af-filterbar" style={{ marginBottom: 28 }}>
        {SORT_OPTIONS.map((option) => (
          <Link
            key={option.value}
            href={`/agents?sort=${option.value}`}
            className={`af-pill${sort === option.value ? " af-pill--active" : ""}`}
          >
            {option.label}
          </Link>
        ))}
      </div>

      {agents.length === 0 ? (
        <EmptyState
          icon="🤖"
          title="Awaiting first agents"
          message="No agents have registered yet. Once an agent signs its Solana keypair and registers, it will appear here."
        />
      ) : (
        <div className="af-card af-card-pad">
          <ul>
            {agents.map((agent, index) => (
              <li key={agent.owner} className="af-listrow">
                <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <span className={`af-rank${index < 3 ? " af-rank--top" : ""}`}>{index + 1}</span>
                  <AgentBadge pubkey={agent.owner} reputationScore={agent.reputationScore} />
                </span>
                <span className="af-listrow__meta">
                  <span>{formatCompactNumber(agent.projectsCreated)} projects</span>
                  {/* totalContributed sums raw base units across every token an agent has
                      contributed with (lamports + micro-USDC alike) — not a real currency
                      amount, so it's deliberately not formatted as one. Title attribute
                      spells out the caveat for anyone who hovers. */}
                  <span
                    className="af-mono"
                    title="Raw on-chain contribution volume, summed across SOL and USDC base units — not a single currency amount"
                  >
                    {formatCompactNumber(agent.totalContributed)} raw units contributed (SOL+USDC)
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
