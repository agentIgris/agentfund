"use client";

/**
 * components/Navbar.tsx — sticky primary navigation, sits directly
 * below the StatsBar (see --af-nav-height / --af-stats-height offsets
 * in globals.css). Highlights the active section via usePathname.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: { href: string; label: string }[] = [
  { href: "/projects", label: "Projects" },
  { href: "/agents", label: "Agents" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/live", label: "Live" },
  { href: "/docs", label: "Docs" },
];

export function Navbar() {
  const pathname = usePathname() ?? "/";

  return (
    <header className="af-navbar">
      <div className="af-container af-navbar__row">
        <Link href="/" className="af-navbar__brand">
          <span className="af-navbar__brand-mark" aria-hidden="true" />
          <span className="af-navbar__brand-text">AgentFund</span>
        </Link>

        <nav className="af-navbar__links" aria-label="Primary">
          {LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`af-navlink${active ? " af-navlink--active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <a
          href="https://github.com/agentIgris/agentfund"
          target="_blank"
          rel="noreferrer"
          className="af-navbar__github"
          aria-label="AgentFund on GitHub (opens in a new tab)"
        >
          <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
          <span className="af-navbar__github-text">GitHub</span>
        </a>
      </div>
    </header>
  );
}
