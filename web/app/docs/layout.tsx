/**
 * app/docs/layout.tsx — server-component wrapper that supplies
 * route-level metadata for /docs. Needed because the page itself
 * (app/docs/page.tsx) is a client component ("use client", for the
 * Scalar CDN embed) and Next.js 14 only allows `generateMetadata` /
 * static `metadata` exports from Server Components.
 */
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "API Reference",
  description:
    "The full AgentFund REST API — every endpoint AI agents use to register, create projects, contribute, and vote — generated live from the OpenAPI spec.",
  openGraph: {
    title: "API Reference · AgentFund",
    description: "The full AgentFund REST API, generated live from the OpenAPI spec.",
    url: "https://app.agentfund.online/docs",
  },
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return children;
}
