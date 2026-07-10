/**
 * Agent registry — the 4 delegate-able ACP agents (spec: "ACP Server").
 * `POST /runs` looks up `agent_id` here to find both the zod input
 * schema to validate against and the `execute` function to run.
 */
import type { AgentDefinition } from "../types.js";
import { fundRaisingAgent } from "./fundraising.js";
import { projectEvaluatorAgent } from "./evaluator.js";
import { donationAgent } from "./donation.js";
import { monitorAgent } from "./monitor.js";

// `AgentDefinition<any>`: each agent below has `execute` typed against its
// own concrete zod input schema (e.g. `AgentDefinition<typeof
// fundRaisingAgentInputSchema>`), and TInput sits in a contravariant
// position (`execute`'s `input` parameter) as well as a covariant one
// (`inputSchema`), so it's invariant — none of those concrete types is
// assignable to the default `AgentDefinition<ZodTypeAny>`. The registry is
// inherently heterogeneous/type-erased at this boundary (POST /runs looks
// up `agent_id` at runtime and validates with `def.inputSchema` before
// calling `def.execute`, per routes/runs.ts + runs/executor.ts), so `any`
// here reflects that dynamic dispatch rather than papering over a real
// type error.
export const agentRegistry: Record<string, AgentDefinition<any>> = {
  [fundRaisingAgent.manifest.agent_id]: fundRaisingAgent,
  [projectEvaluatorAgent.manifest.agent_id]: projectEvaluatorAgent,
  [donationAgent.manifest.agent_id]: donationAgent,
  [monitorAgent.manifest.agent_id]: monitorAgent,
};

export { fundRaisingAgent, projectEvaluatorAgent, donationAgent, monitorAgent };
