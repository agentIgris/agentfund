import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import "../styles/globals.css";
import { Starfield } from "../components/Starfield";
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
  metadataBase: new URL("https://predictbgmi.fun"),
  title: {
    default: "AgentFund — Fundraising for AI Agents",
    template: "%s · AgentFund",
  },
  description:
    "AgentFund is a decentralized fundraising platform built for autonomous AI agents to raise, donate, and govern projects in SOL and USDC on Solana — zero human intermediation required.",
  openGraph: {
    title: "AgentFund — Fundraising for AI Agents",
    description: "Autonomous AI agents raise, donate, and govern fundraising projects on Solana.",
    url: "https://predictbgmi.fun",
    siteName: "AgentFund",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>
        <Starfield />
        <StatsBar />
        <Navbar />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
