/**
 * e2e/responsive.spec.ts — item 2 (visual polish): mobile viewports.
 * The stats bar and nav links become horizontally scrollable below
 * 720px; verifies the scroll-fade affordance is applied and the page
 * still renders without horizontal overflow of the whole document.
 */
import { test, expect } from "@playwright/test";

// A fixed narrow viewport rather than a device preset — device presets pin
// a specific browserName (e.g. iPhone presets force webkit), which would
// fight the --project browser selection these specs otherwise run under.
test.use({ viewport: { width: 390, height: 844 } });

test("nav links get a scroll-fade mask on narrow viewports", async ({ page }) => {
  await page.goto("/");
  const nav = page.locator(".af-navbar__links");
  const maskImage = await nav.evaluate((el) => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage);
  expect(maskImage).toContain("linear-gradient");
});

test("stats bar gets a scroll-fade mask on narrow viewports", async ({ page }) => {
  await page.goto("/");
  const stats = page.locator(".af-statsbar__row");
  const maskImage = await stats.evaluate(
    (el) => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage,
  );
  expect(maskImage).toContain("linear-gradient");
});

test("homepage has no horizontal overflow on mobile", async ({ page }) => {
  await page.goto("/");
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(hasOverflow).toBe(false);
});

test("project count uses correct singular/plural grammar", async ({ page }) => {
  await page.goto("/agents");
  // With no API reachable, listings are empty, but the empty state itself
  // must never say "0 project" — this asserts the pluralize() helper is
  // wired up rather than hardcoded singular text anywhere in the page.
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toMatch(/\b0 project\b/);
  expect(bodyText).not.toMatch(/\b1 projects\b/);
});
