// One-off: replay historical devnet txs for the three AgentFund programs
// through the live Helius webhook receiver, so the DB backfills the
// campaign that predates webhook registration.
// Usage: node replay-devnet-history.mjs <rpc-url> <webhook-url> <secret>
const [rpc, webhook, secret] = process.argv.slice(2);
if (!rpc || !webhook || !secret) throw new Error("args: rpc webhook secret");

const PROGRAMS = [
  "2TqDeKaadPUeBcgaXXqYAqddfZngUfbq4m8iDSyePSBA",
  "HiuwNu1K927uTd8xvVCXUHvJW7BcBCgrNBAMC3qUN1Sz",
  "7DVKSmmhKVWW5JpwWCS89Fi6uwj3RaPADEBbVqyH8Zo7",
];

async function rpcCall(method, params) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}

const seen = new Map(); // signature -> slot
for (const p of PROGRAMS) {
  const sigs = await rpcCall("getSignaturesForAddress", [p, { limit: 100 }]);
  for (const s of sigs) if (!s.err) seen.set(s.signature, s.slot);
}
const ordered = [...seen.entries()].sort((a, b) => a[1] - b[1]);
console.log(`found ${ordered.length} successful txs across programs`);

const payload = [];
for (const [signature] of ordered) {
  const tx = await rpcCall("getTransaction", [
    signature,
    { encoding: "json", maxSupportedTransactionVersion: 0 },
  ]);
  if (!tx?.meta?.logMessages) continue;
  payload.push({ signature, slot: tx.slot, meta: { logMessages: tx.meta.logMessages } });
}
console.log(`replaying ${payload.length} txs -> ${webhook}`);

const res = await fetch(webhook, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: secret },
  body: JSON.stringify(payload),
});
console.log("webhook response:", res.status, await res.text());
