/**
 * e2e/empty-states.spec.ts — with no API reachable (this suite's default
 * config, see playwright.config.ts), every data-driven page must degrade
 * to a clear, correctly-worded EmptyState instead of a blank screen or a
 * crash. This is also the regression test for the original dashboard bug
 * (item 1: a titleless "test project" card rendering instead of a proper
 * empty state) and for the EmptyState title mismatches fixed in this pass
 * (item 6/8) — every title below must describe what's actually missing,
 * not a copy-pasted platform-wide message.
 */
import { test, expect } from "@playwright/test";

test("homepage renders without a live API", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".af-statsbar__item").first()).toContainText(/Connecting|Live/);
  // No stray title-less project card — the bug this whole audit started from.
  await expect(page.locator(".af-projectcard")).toHaveCount(0);
});

test("projects list shows a correctly-worded empty state", async ({ page }) => {
  await page.goto("/projects");
  const empty = page.locator(".af-empty");
  await expect(empty).toBeVisible();
  await expect(empty.locator(".af-empty__title")).toHaveText("No projects found");
});

test("agents list shows a correctly-worded empty state", async ({ page }) => {
  await page.goto("/agents");
  const empty = page.locator(".af-empty");
  await expect(empty).toBeVisible();
});

test("leaderboard shows the platform-wide awaiting-data state", async ({ page }) => {
  await page.goto("/leaderboard");
  await expect(page.locator(".af-empty").first()).toBeVisible();
});

test("stats bar shows the awaiting-data message, not fabricated numbers", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".af-statsbar__row")).toContainText(
    "Awaiting first agents — stats will appear once the API is reachable.",
  );
});

test("no unhandled client-side exceptions on any core route", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  for (const path of ["/", "/projects", "/agents", "/leaderboard", "/live", "/docs"]) {
    await page.goto(path);
  }

  expect(errors).toEqual([]);
});
