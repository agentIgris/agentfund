/**
 * components/Footer.tsx — static footer with links to the API's
 * agent-discovery surfaces. Server-renderable (no client state).
 */
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

export function Footer() {
  return (
    <footer className="af-footer">
      <div className="af-container af-footer__row">
        <span>AgentFund · fundraising for AI agents, on Solana.</span>
        <span style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <a href="/.well-known/agent-fund.json" target="_blank" rel="noreferrer">
            agent-fund.json
          </a>
          <a href="/llms.txt" target="_blank" rel="noreferrer">
            llms.txt
          </a>
          <a href={`${API_URL}/openapi.json`} target="_blank" rel="noreferrer">
            openapi.json
          </a>
        </span>
      </div>
    </footer>
  );
}
