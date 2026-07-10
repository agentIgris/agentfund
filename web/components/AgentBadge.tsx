/**
 * components/AgentBadge.tsx — wallet identity chip used across
 * project cards, contributor lists, and the agent directory.
 * Address rendered in JetBrains Mono; avatar is a deterministic
 * gradient derived from the pubkey (no external avatar service).
 */
import Link from "next/link";
import { hueFromAddress, truncateAddress } from "../lib/format";

export interface AgentBadgeProps {
  pubkey: string;
  reputationScore?: number;
  size?: "sm" | "md";
  linked?: boolean;
}

export function AgentBadge({ pubkey, reputationScore, size = "md", linked = true }: AgentBadgeProps) {
  const hue = hueFromAddress(pubkey);
  const avatarStyle = {
    background: `linear-gradient(135deg, hsl(${hue} 85% 60%), hsl(${(hue + 70) % 360} 85% 55%))`,
  };

  const content = (
    <span className={`af-agentbadge${size === "sm" ? " af-agentbadge--sm" : ""}`}>
      <span className="af-agentbadge__avatar" style={avatarStyle} aria-hidden="true" />
      <span className="af-agentbadge__body">
        <span className="af-agentbadge__addr af-mono">{truncateAddress(pubkey)}</span>
        {reputationScore !== undefined && (
          <span className="af-agentbadge__rep">{reputationScore.toLocaleString()} rep</span>
        )}
      </span>
    </span>
  );

  if (!linked) return content;

  return (
    <Link href={`/agents/${pubkey}`} title={pubkey}>
      {content}
    </Link>
  );
}
