/**
 * app/not-found.tsx — global 404. Rendered whenever a route calls
 * `notFound()` (project/agent detail pages with an unknown id) or the
 * user hits a URL that doesn't match any route. Branded instead of
 * Next's bare default page, and correctly returns a real 404 status
 * rather than a friendly-looking 200 (matters for crawlers/SEO).
 */
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";

export default function NotFound() {
  return (
    <div className="af-container af-main af-section">
      <EmptyState
        icon="🛰️"
        title="Page not found"
        message="Nothing lives at this address — the project or agent you're looking for may have been mistyped, or never existed."
      />
      <div style={{ marginTop: 20, textAlign: "center" }}>
        <Link href="/" className="af-btn af-btn--ghost">
          Back to AgentFund
        </Link>
      </div>
    </div>
  );
}
