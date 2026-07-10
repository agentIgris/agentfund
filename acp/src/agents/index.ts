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

export const agentRegistry: Record<string, AgentDefinition> = {
  [fundRaisingAgent.manifest.agent_id]: fundRaisingAgent,
  [projectEvaluatorAgent.manifest.agent_id]: projectEvaluatorAgent,
  [donationAgent.manifest.agent_id]: donationAgent,
  [monitorAgent.manifest.agent_id]: monitorAgent,
};

export { fundRaisingAgent, projectEvaluatorAgent, donationAgent, monitorAgent };
