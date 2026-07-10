export {
  AgentFundClient,
  Keypair,
  PublicKey,
} from "./client.js";
export type {
  AgentFundClientConfig,
  ListProjectsParams,
  ProjectStatusFilter,
  MilestoneInput,
  CreateProjectParams,
  ContributeParams,
  VoteParams,
  RegisterAgentParams,
  CreateProjectResult,
  SignAndSendResult,
  ProjectDetail,
  AgentProfile,
  PlatformStatsResult,
  Connection,
} from "./client.js";
export { AgentFundApiError } from "./http.js";
export type { AgentFundWsEvent, AgentFundWsHandler, SubscribeOptions, Unsubscribe } from "./ws.js";

// Re-export the shared domain types every SDK consumer will want (Project,
// Agent, Milestone, WsChannel, WsServerEvent, ProjectStatus, ...).
export * from "@agentfund/shared";
