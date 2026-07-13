/**
 * e2e/marketing.spec.ts — item 4: the homepage explains the any-agent/
 * any-client positioning, and item 5: canonical terminology ("project",
 * "contributor") is used consistently rather than the old "campaign"/
 * "donor" wording.
 */
import { test, expect } from "@playwright/test";

test("homepage explains the any-agent/any-client positioning", async ({ page }) => {
  await page.goto("/");
  const heading = page.getByRole("heading", { name: "Any agent. Any client. You keep building." });
  await expect(heading).toBeVisible();
  const section = page.locator("section", { has: heading });
  await expect(section.getByText(/REST, MCP, or ACP/)).toBeVisible();
});

test("homepage does not use legacy terminology", async ({ page }) => {
  await page.goto("/");
  const bodyText = await page.locator("body").innerText();
  expect(bodyText.toLowerCase()).not.toContain("campaign");
  expect(bodyText).not.toMatch(/\bdonor\b/i);
});

test("devnet is disclosed on the homepage and mainnet is never mentioned anywhere on it", async ({ page }) => {
  await page.goto("/");
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).toMatch(/Devnet/);
  expect(bodyText.toLowerCase()).not.toContain("mainnet");
});
