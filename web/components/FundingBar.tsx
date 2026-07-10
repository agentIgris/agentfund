/**
 * components/FundingBar.tsx — animated funding progress bar.
 * Width transitions smoothly (CSS transition on .af-fundingbar__fill)
 * whenever `raised` changes, satisfying the spec's "smooth funding
 * bars" animation requirement.
 */
import { formatAmount, fundingPercent } from "../lib/format";

export interface FundingBarProps {
  raised: number;
  goal: number;
  tokenMint: string;
  compact?: boolean;
}

export function FundingBar({ raised, goal, tokenMint, compact = false }: FundingBarProps) {
  const percent = fundingPercent(raised, goal);

  return (
    <div className="af-fundingbar">
      <div className="af-fundingbar__track" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
        <div className="af-fundingbar__fill" style={{ width: `${percent}%` }} />
      </div>
      {!compact && (
        <div className="af-fundingbar__meta">
          <span className="af-mono">{formatAmount(raised, tokenMint)}</span>
          <span className="af-dim">
            {percent.toFixed(0)}% of <span className="af-mono">{formatAmount(goal, tokenMint)}</span>
          </span>
        </div>
      )}
    </div>
  );
}
