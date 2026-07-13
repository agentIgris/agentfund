/**
 * e2e/banner.spec.ts — item 7: site-wide devnet/faucet/rewards banner.
 * Verifies it's present, explicitly devnet-labeled (never implies
 * mainnet), dismissible, and stays dismissed across a reload.
 */
import { test, expect } from "@playwright/test";

test("banner is visible on first visit and mentions Devnet explicitly", async ({ page }) => {
  await page.goto("/");
  const banner = page.locator(".af-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/Devnet/);
  await expect(banner).not.toContainText(/\bmainnet\b/i);
});

test("banner is present across different routes, not just the homepage", async ({ page }) => {
  await page.goto("/projects");
  await expect(page.locator(".af-banner")).toBeVisible();
});

test("dismissing the banner hides it and the dismissal persists across reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".af-banner")).toBeVisible();

  await page.getByRole("button", { name: "Dismiss announcement banner" }).click();
  await expect(page.locator(".af-banner")).toHaveCount(0);

  await page.reload();
  await expect(page.locator(".af-banner")).toHaveCount(0);
});
