/**
 * routes/agents.ts — GET /agents: the manifest list of all delegate-able
 * ACP agents (spec: "GET /agents -> manifest list (also mirror as
 * src/manifests/agents.yaml)"). src/manifests/agents.yaml is a static,
 * hand-mirrored copy of the same data for anything that reads the ACP
 * manifest as a file rather than over HTTP (e.g. a directory crawler);
 * regenerate it with `npm run gen:manifest --workspace acp` after
 * editing src/manifests/agents.ts.
 */
import type { FastifyInstance } from "fastify";
import { agentManifests } from "../manifests/agents.js";

export function registerAgentManifestRoutes(app: FastifyInstance): void {
  app.get("/agents", async (_request, reply) => {
    return reply.send({ agents: agentManifests });
  });
}
