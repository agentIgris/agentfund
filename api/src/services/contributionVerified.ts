import type { WsContributionVerifiedEvent } from "@agentfund/shared";
import { broker } from "./broker.js";

export interface ContributionVerifiedInput {
  projectId: string;
  botId: string;
  actionRecordId: string;
  signature: string;
  authorizationHash: string;
}

export function createContributionVerifiedEvent(
  input: ContributionVerifiedInput,
): WsContributionVerifiedEvent {
  return {
    type: "contribution.verified",
    data: input,
  };
}

export async function emitContributionVerified(
  input: ContributionVerifiedInput,
  publish: (channel: string, payload: Record<string, unknown>) => Promise<void> =
    broker.publish.bind(broker),
): Promise<WsContributionVerifiedEvent> {
  const event = createContributionVerifiedEvent(input);
  await publish("contributions", { ...event });
  return event;
}
