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
      </div>
    </header>
  );
}
