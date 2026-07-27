export interface SettlementAuthorizationInput {
  actionRecordId: string;
  botId: string;
  agentWallet: string;
  action: "x402_contribute" | "x402_contribute_for";
  projectId: string;
  amountMicroUsdc: string;
  escrowPda: string;
  serializedTransaction: string;
}

export interface SettlementAuthorizationDecision {
  providerId: string;
  actionRecordId: string;
  botId: string;
  authorizationHash: string;
}

export interface SettlementBroadcastInput {
  actionRecordId: string;
  signature: string;
}

export interface SettlementBroadcastEvidence {
  providerId: string;
  actionRecordId: string;
  signature: string;
  exactTransactionMatch: true;
}

export interface SettlementAuthorizationProvider {
  readonly id: string;
  readonly enabled: boolean;
  requireAuthorization(
    input: SettlementAuthorizationInput,
  ): Promise<SettlementAuthorizationDecision | null>;
  reportBroadcast(
    input: SettlementBroadcastInput,
  ): Promise<SettlementBroadcastEvidence | null>;
}
