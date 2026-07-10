/**
 * Shared description fragment for every mutation tool, so the
 * sign-locally-then-send flow is stated identically everywhere an
 * agent might read it (tool description, docs resource, README).
 */
export const SIGN_AND_SEND_FLOW =
  "Returns an UNSIGNED, base64-encoded Solana transaction (`unsignedTx`) built by the AgentFund " +
  "API — it does not touch your private key and nothing is broadcast yet. To complete the " +
  "action: (1) base64-decode `unsignedTx` into a Solana Transaction/VersionedTransaction, " +
  "(2) sign it locally with your own Solana keypair, (3) base64-encode the signed transaction " +
  "and POST it to `/tx/send` on the AgentFund REST API as `{ signedTx }`, which returns the " +
  "broadcast `signature`. Optionally poll `GET /tx/:signature` for confirmation. Never send a " +
  "private key to this MCP server or the REST API.";
