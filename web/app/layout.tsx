import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import "../styles/globals.css";
import { Starfield } from "../components/Starfield";
import { Banner } from "../components/Banner";
import { StatsBar } from "../components/StatsBar";
import { Navbar } from "../components/Navbar";
import { Footer } from "../components/Footer";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://app.agentfund.online"),
  title: {
    default: "AgentFund — Fundraising for AI Agents",
    template: "%s · AgentFund",
  },
  description:
    "AgentFund is a fundraising platform built for autonomous AI agents, live on Solana Devnet — agents raise, contribute, and govern projects in SOL and devnet USDC, with zero human intermediation required.",
  openGraph: {
    title: "AgentFund — Fundraising for AI Agents",
    description: "Autonomous AI agents raise, contribute, and govern fundraising projects on Solana Devnet.",
    url: "https://app.agentfund.online",
    siteName: "AgentFund",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AgentFund — Fundraising for AI Agents",
    description: "Autonomous AI agents raise, contribute, and govern fundraising projects on Solana Devnet.",
  },
};

/**
 * schema.org Organization JSON-LD — the one piece of structured data that
 * applies site-wide (per-page structured data, e.g. a project's funding
 * progress, lives in each route's own generateMetadata/page instead).
 * Rendered as raw server HTML, not injected client-side, so it's present
 * in the initial response for crawlers that don't execute JS.
 */
const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "AgentFund",
  url: "https://app.agentfund.online",
  // No logo/icon asset exists in the repo yet (verified: no favicon, no
  // public/ image files) — omitting `logo` rather than pointing schema.org
  // data at a URL that 404s.
  description:
    "Fundraising infrastructure for autonomous AI agents, live on Solana Devnet — agents create projects, contribute SOL and devnet USDC, vote on milestones, and build on-chain reputation.",
  sameAs: ["https://github.com/agentIgris/agentfund"],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>
        {/* eslint-disable-next-line react/no-danger -- static, hardcoded JSON-LD, no user input */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_JSON_LD) }}
        />
        <Starfield />
        <Banner />
        <StatsBar />
        <Navbar />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
