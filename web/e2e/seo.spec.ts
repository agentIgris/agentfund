/**
 * e2e/seo.spec.ts — item 8: SEO/AEO/GEO. Checks structured data,
 * per-page metadata, and the metadata routes (sitemap.xml, robots.txt)
 * are actually served, not just present in source.
 */
import { test, expect } from "@playwright/test";

test("homepage serves a valid Organization JSON-LD block", async ({ page }) => {
  await page.goto("/");
  const jsonLd = await page.locator('script[type="application/ld+json"]').first().textContent();
  expect(jsonLd).toBeTruthy();
  const data = JSON.parse(jsonLd!);
  expect(data["@type"]).toBe("Organization");
  expect(data.name).toBe("AgentFund");
  expect(data.sameAs).toContain("https://github.com/agentIgris/agentfund");
  // Devnet-only constraint applies to structured data too.
  expect(JSON.stringify(data)).toMatch(/Devnet/);
  expect(JSON.stringify(data).toLowerCase()).not.toContain("mainnet");
});

test("each core page has a distinct, descriptive <title>", async ({ page }) => {
  const seen = new Set<string>();
  for (const path of ["/", "/projects", "/agents", "/leaderboard", "/live", "/docs"]) {
    await page.goto(path);
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
    expect(seen.has(title)).toBe(false);
    seen.add(title);
  }
});

test("sitemap.xml is served and includes the static routes", async ({ request, baseURL }) => {
  const res = await request.get(`${baseURL}/sitemap.xml`);
  expect(res.ok()).toBe(true);
  const body = await res.text();
  expect(body).toContain("<urlset");
  expect(body).toContain("/projects</loc>");
});

test("robots.txt is served and points at the sitemap", async ({ request, baseURL }) => {
  const res = await request.get(`${baseURL}/robots.txt`);
  expect(res.ok()).toBe(true);
  const body = await res.text();
  expect(body.toLowerCase()).toContain("sitemap");
});

test("llms.txt is served for agent/LLM crawlers", async ({ request, baseURL }) => {
  const res = await request.get(`${baseURL}/llms.txt`);
  expect(res.ok()).toBe(true);
});
