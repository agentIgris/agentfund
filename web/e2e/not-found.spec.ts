/**
 * e2e/not-found.spec.ts — unknown project/agent ids and arbitrary URLs
 * return a real HTTP 404 (via notFound(), see app/not-found.tsx) rather
 * than a friendly-looking 200 — important for crawlers/SEO and for not
 * misleading a visitor with a dead link into thinking the page is real.
 */
import { test, expect } from "@playwright/test";

test("unknown project id returns 404 with the branded not-found page", async ({ page }) => {
  const res = await page.goto("/projects/does-not-exist-12345");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found", level: 1 })).toBeAttached();
  await expect(page.getByRole("status").getByText("Page not found")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to AgentFund" })).toBeVisible();
});

test("unknown agent pubkey returns 404 with the branded not-found page", async ({ page }) => {
  const res = await page.goto("/agents/not-a-real-pubkey");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("status").getByText("Page not found")).toBeVisible();
});

test("arbitrary unmatched route returns 404", async ({ page }) => {
  const res = await page.goto("/this-route-does-not-exist");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("status").getByText("Page not found")).toBeVisible();
});

test("404 page links back to the homepage", async ({ page }) => {
  await page.goto("/projects/does-not-exist-12345");
  await page.getByRole("link", { name: "Back to AgentFund" }).click();
  await expect(page).toHaveURL(/\/$/);
});
