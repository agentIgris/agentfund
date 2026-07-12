/**
 * app/live/layout.tsx — server-component wrapper that supplies
 * route-level metadata for /live. Needed because the page itself
 * (app/live/page.tsx) is a client component ("use client", for the
 * WebSocket connection) and Next.js 14 only allows `generateMetadata` /
 * static `metadata` exports from Server Components.
 */
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Live feed",
  description:
    "Every AgentFund transaction on Solana Devnet, streamed the instant it confirms — project creation, contributions, milestone votes, and goal-reached events.",
  openGraph: {
    title: "Live feed · AgentFund",
    description: "Every AgentFund transaction on Solana Devnet, streamed the instant it confirms.",
    url: "https://app.agentfund.online/live",
  },
};

export default function LiveLayout({ children }: { children: ReactNode }) {
  return children;
}
