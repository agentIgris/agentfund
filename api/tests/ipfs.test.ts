/**
 * tests/ipfs.test.ts — unit tests for the self-hosted metadata pinning
 * fallback (services/ipfs.ts's pinJsonSelfHosted, exercised via the public
 * pinJson) used whenever PINATA_JWT isn't configured. This is the fix for
 * the production bug where POST /projects 500s for every caller because
 * no Pinata account is set up — see indexer.ts / routes/metadata.ts.
 * Prisma and config are mocked; no real DB is touched.
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    metadataBlob: {
      upsert: (...args: unknown[]) => upsert(...args),
    },
  },
}));

vi.mock("../src/config.js", () => ({
  config: {
    pinata: { jwt: "" },
    apiBaseUrl: "https://api.agentfund.online/",
  },
}));

import { pinJson } from "../src/services/ipfs.js";

describe("pinJson (self-hosted fallback, PINATA_JWT unset)", () => {
  beforeEach(() => {
    upsert.mockReset();
    upsert.mockResolvedValue(undefined);
  });

  it("stores the exact canonical JSON.stringify bytes, content-addressed by their own sha256", async () => {
    const data = { title: "Test Project", description: "hello" };
    const canonical = JSON.stringify(data);
    const expectedHash = createHash("sha256").update(canonical).digest("hex");

    const ref = await pinJson(data);

    expect(upsert).toHaveBeenCalledTimes(1);
    const call = upsert.mock.calls[0][0];
    expect(call.where).toEqual({ hash: expectedHash });
    expect(call.create).toEqual({ hash: expectedHash, content: canonical });

    expect(ref).toBe(
      `https://api.agentfund.online/metadata/blob/${expectedHash}#sha256=${expectedHash}`,
    );
  });

  it("strips a trailing slash from API_BASE_URL so URLs don't end up with a double slash", async () => {
    const ref = await pinJson({ title: "x" });
    expect(ref).not.toContain("//metadata");
    expect(ref.startsWith("https://api.agentfund.online/metadata/blob/")).toBe(true);
  });

  it("the #sha256= fragment matches the hash in the path (what resolveMetadataJson verifies against)", async () => {
    const ref = await pinJson({ title: "verify-me" });
    const [, fragment] = ref.split("#sha256=");
    const pathHash = ref.split("/metadata/blob/")[1].split("#")[0];
    expect(fragment).toBe(pathHash);
    expect(fragment).toMatch(/^[0-9a-f]{64}$/);
  });
});
