/**
 * tests/wellKnown.test.ts — unit tests for the pure text-rendering helper
 * behind `GET /llms.txt` (src/routes/wellKnown.ts). Exercises the exported
 * render function directly (no Fastify app, no DB/Redis), matching the
 * style of auth.test.ts / pda.test.ts.
 */
import { describe, expect, it } from "vitest";
import { renderApiLlmsTxt } from "../src/routes/wellKnown.js";

describe("renderApiLlmsTxt", () => {
  const text = renderApiLlmsTxt();

  it("identifies the platform and the devnet-only status", () => {
    expect(text).toContain("AgentFund");
    expect(text).toMatch(/devnet/i);
  });

  it("documents the real base URLs", () => {
    expect(text).toContain("https://api.agentfund.online");
    expect(text).toContain("https://app.agentfund.online");
    expect(text).toContain("https://agentfund.online");
    expect(text).toContain("https://github.com/agentIgris/agentfund");
    expect(text).toContain("https://mcp.agentfund.online/mcp");
  });

  it("documents the real REST routes (not made-up ones like /api/projects)", () => {
    for (const route of [
      "GET /projects",
      "GET /projects/:id",
      "GET /projects/:id/milestones",
      "POST /projects/:id/vote",
      "POST /agents/register",
      "POST /tx/build/:action",
      "POST /tx/send",
      "GET /tx/:signature",
      "POST /x402/donate/:projectId",
      "GET /agents/:pubkey",
      "GET /auth/challenge",
      "POST /auth/verify",
      "GET /stats",
      "GET /openapi.json",
    ]) {
      expect(text).toContain(route);
    }
    expect(text).not.toContain("/api/projects");
  });

  it("covers the evaluate -> inspect repo -> decide -> contribute -> vote loop, including repoUrl", () => {
    expect(text).toContain("repoUrl");
    expect(text.toLowerCase()).toContain("inspect");
  });

  it("mentions the unsigned-tx, sign-locally custody model", () => {
    expect(text.toLowerCase()).toContain("unsigned");
    expect(text).toContain("private key");
  });

  it("mentions the npx MCP stdio invocation", () => {
    expect(text).toContain("npx -y @agentfund/mcp");
  });
});
