/**
 * e2e/navigation.spec.ts — every top-level route resolves, the primary
 * nav links to the right places and marks the active section, and the
 * GitHub link (item 3 of the audit) is present and correct everywhere.
 */
import { test, expect } from "@playwright/test";

const ROUTES: { path: string; navLabel: RegExp; heading: RegExp }[] = [
  { path: "/projects", navLabel: /^Projects$/i, heading: /Projects/i },
  { path: "/agents", navLabel: /^Agents$/i, heading: /Agents/i },
  { path: "/leaderboard", navLabel: /^Leaderboard$/i, heading: /Leaderboard/i },
  { path: "/live", navLabel: /^Live$/i, heading: /Live feed/i },
  { path: "/docs", navLabel: /^Docs$/i, heading: /API Reference/i },
];

test.describe("primary navigation", () => {
  for (const { path, navLabel, heading } of ROUTES) {
    test(`nav link to ${path} loads the right page`, async ({ page }) => {
      await page.goto("/");
      const link = page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: navLabel });
      // Wait for the link to actually be clickable (client hydration) before
      // clicking — under parallel load a pre-hydration click can land on a
      // handler-less anchor and never navigate.
      await link.waitFor({ state: "visible" });
      await link.click();
      // Slightly longer than the default 5s: under full-suite parallel load
      // (mobile CPU throttling + many concurrent dev-server compiles) a
      // client-side route transition can occasionally take a few seconds
      // longer than in isolation.
      await expect(page).toHaveURL(new RegExp(`${path}$`), { timeout: 15_000 });
      await expect(page.getByRole("heading", { level: 1 })).toContainText(heading);
    });
  }

  test("active nav link is marked with aria-current", async ({ page }) => {
    await page.goto("/projects");
    const activeLink = page.locator(".af-navlink--active");
    await expect(activeLink).toHaveAttribute("aria-current", "page");
    await expect(activeLink).toHaveText(/Projects/);
  });

  test("brand link returns home", async ({ page }) => {
    await page.goto("/projects");
    await page.locator("a.af-navbar__brand").click();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("GitHub link", () => {
  for (const path of ["/", "/projects", "/agents", "/leaderboard"]) {
    test(`GitHub link is present and correct on ${path}`, async ({ page }) => {
      await page.goto(path);
      const link = page.locator("a.af-navbar__github");
      await expect(link).toHaveAttribute("href", "https://github.com/agentIgris/agentfund");
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noreferrer");
    });
  }
});
