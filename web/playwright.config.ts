/**
 * playwright.config.ts — end-to-end config for the AgentFund human
 * dashboard (web/). Runs a production build (`next build && next start`)
 * and runs every spec in e2e/ against it — not `next dev`. `next dev`
 * compiles routes on demand per-request, and under this suite's parallel
 * workers that produced real webpack chunk corruption (concurrent
 * first-compiles of the same route racing each other, e.g.
 * "Cannot find module './xxx.js'"); a production build compiles once
 * up front and serves static output, which is both more stable and a
 * closer match to how Vercel actually serves this app.
 *
 * Deliberately does NOT depend on the live AgentFund API being reachable:
 * every page in this app is written to render a graceful EmptyState when
 * the API is down (see lib/api.ts), so these tests assert on structure,
 * navigation, accessibility, and the app's own no-API fallback behavior
 * rather than on specific on-chain data. That keeps the suite deterministic
 * in CI, where no devnet API is running.
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // Build and start in one invocation so the same env (below) applies to
    // both — NEXT_PUBLIC_* values are inlined into the client bundle at
    // build time, so setting them only for `next start` wouldn't work.
    command: `npx next build && npx next start -p ${PORT}`,
    url: BASE_URL,
    // Always start a fresh server for this suite, even if one is already
    // running on PORT for local dev/preview — `reuseExistingServer` would
    // otherwise happily attach to a differently-configured instance (e.g.
    // one pointed at the live API via .env.local) and silently break the
    // "no API" determinism this suite relies on.
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      // Explicitly override web/.env.local, which points local dev at the
      // live production API (https://api.agentfund.online) for manual
      // preview convenience. Process env set here wins over .env.local in
      // Next's load order, so this suite always exercises the app's
      // documented no-API EmptyState fallback deterministically, rather
      // than depending on live devnet data that changes over time.
      NEXT_PUBLIC_API_URL: "http://127.0.0.1:1",
      NEXT_PUBLIC_WS_URL: "ws://127.0.0.1:1/ws",
    },
  },
});
