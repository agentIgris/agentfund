/**
 * scripts/gen-manifest.ts — regenerates src/manifests/agents.yaml from
 * src/manifests/agents.ts (the runtime source of truth served by
 * GET /agents). Run via `npm run gen:manifest --workspace acp` any time
 * agents.ts changes, so the static YAML mirror never drifts.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import yaml from "js-yaml";
import { agentManifests } from "../src/manifests/agents.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(here, "../src/manifests/agents.yaml");

const header =
  "# GENERATED FILE — do not hand-edit.\n" +
  "# Regenerate with `npm run gen:manifest --workspace acp` after changing\n" +
  "# src/manifests/agents.ts. This is a static mirror of what GET /agents\n" +
  "# returns at runtime (spec: \"GET /agents -> manifest list (also mirror\n" +
  "# as src/manifests/agents.yaml)\").\n";

const body = yaml.dump(
  { agents: agentManifests },
  { noRefs: true, lineWidth: 100 },
);

writeFileSync(outPath, header + body, "utf8");
// eslint-disable-next-line no-console
console.log(`Wrote ${outPath}`);
