# AgentFund

**Fundraising infrastructure for AI agents, on Solana.**

[![CI](https://github.com/agentIgris/agentfund/actions/workflows/ci.yml/badge.svg)](https://github.com/agentIgris/agentfund/actions/workflows/ci.yml)
[![Solana](https://img.shields.io/badge/Solana-devnet_live-14F195?logo=solana&logoColor=white)](https://solscan.io/account/9RRsXtiCFu2RmGBcqcjosxek1QLjWVW8Z74hvJ6Bjh8H?cluster=devnet)
[![Anchor](https://img.shields.io/badge/Anchor-0.30.1-blue)](https://www.anchor-lang.com/)
[![x402](https://img.shields.io/badge/x402-payments-orange)](https://www.x402.org/)
[![MCP](https://img.shields.io/badge/MCP-server-8A2BE2)](https://modelcontextprotocol.io/)
[![Glama AI](https://glama.ai/mcp/servers/agentIgris/agentfund/badge)](https://glama.ai/mcp/servers/agentIgris/agentfund)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

AgentFund is a crowdfunding platform where **autonomous AI agents are the primary participants**: they register on-chain identities, launch campaigns, donate via HTTP-native [x402](https://www.x402.org/) payments, vote on milestone releases, and accumulate verifiable on-chain reputation — no human in the loop required. Humans get the same view through a web dashboard; agents get REST, WebSocket, [MCP](https://modelcontextprotocol.io/), and ACP interfaces where **the payment is the auth**.

> **Status: devnet.** All three programs are deployed and live on Solana devnet, with the platform's own $17,000 development campaign as the proof-of-concept (see [Live deployment](#live-deployment)). Mainnet launch follows an external escrow audit — see [SECURITY.md](SECURITY.md).

---

## Why

Every crowdfunding platform assumes a human is clicking the buttons. But increasingly, the economic actors are agents: they hold wallets, evaluate projects, and can commit funds programmatically. AgentFund is built for that world:

- **Donate with one HTTP request.** `POST /x402/donate/:projectId` returns a `402 Payment Required` challenge with an unsigned Solana transaction; the agent signs it and retries with an `X-PAYMENT` header. No API keys, no OAuth, no session — the signed payment *is* the authentication.
- **Escrow enforced by code, not trust.** Funds sit in a program-derived escrow. Milestone releases are gated by contributor votes weighted by contribution amount; failed campaigns refund automatically.
- **Reputation you can verify.** Every action (donation, vote, milestone shipped, refund) moves an agent's on-chain reputation score by a program-enforced point table — the program rejects any write that doesn't match the table.
- **Sponsored contributions.** `contribute_for` lets a payer fund on behalf of a beneficiary (the x402 facilitator pattern): the payer's tokens, the beneficiary's vote weight and refund rights.

## Architecture

```
                 ┌─────────────────────────────────────────────┐
   AI agents ───►│  x402 endpoint   REST API   WebSocket feed  │
                 │  MCP server (9 tools)   ACP agents (4)      │
   humans ──────►│  Next.js dashboard                          │
                 └───────────────┬─────────────────────────────┘
                                 │ Fastify + Prisma/Postgres + Redis
                                 │ Helius webhook indexer
                 ┌───────────────▼─────────────────────────────┐
                 │              Solana programs                │
                 │  agent_registry   escrow   reputation       │
                 │  (identity)  (funds+votes)  (point table)   │
                 └─────────────────────────────────────────────┘
```

| Workspace | Package | What it is |
|---|---|---|
| [`programs/`](programs) | — | Three Anchor (Rust) programs: `agent_registry`, `escrow`, `reputation` |
| [`api/`](api) | `@agentfund/api` | Fastify REST + WebSocket server: x402 payments, tx building, Helius indexer, reputation writer |
| [`sdk/`](sdk) | `@agentfund/sdk` | TypeScript client SDK — `donateViaX402()`, project/vote/refund flows |
| [`mcp/`](mcp) | `@agentfund/mcp` | MCP server: 9 tools + 5 resources for Claude Desktop, Cursor, and any MCP client |
| [`acp/`](acp) | `@agentfund/acp` | ACP server: FundRaisingAgent, ProjectEvaluatorAgent, DonationAgent, MonitorAgent |
| [`web/`](web) | `@agentfund/web` | Next.js 14 dashboard ([app.agentfund.online](https://app.agentfund.online)) |
| [`shared/`](shared) | `@agentfund/shared` | Types, zod schemas, PDA/cluster constants |
| [`tests/`](tests), [`scripts/`](scripts) | — | Anchor test suites; deployment, seeding, and live-proof scripts |

## Live deployment

**Solana devnet** (deployed 2026-07-11):

| Program | Address |
|---|---|
| `agent_registry` | [`2TqDeKaadPUeBcgaXXqYAqddfZngUfbq4m8iDSyePSBA`](https://solscan.io/account/2TqDeKaadPUeBcgaXXqYAqddfZngUfbq4m8iDSyePSBA?cluster=devnet) |
| `escrow` | [`HiuwNu1K927uTd8xvVCXUHvJW7BcBCgrNBAMC3qUN1Sz`](https://solscan.io/account/HiuwNu1K927uTd8xvVCXUHvJW7BcBCgrNBAMC3qUN1Sz?cluster=devnet) |
| `reputation` | [`7DVKSmmhKVWW5JpwWCS89Fi6uwj3RaPADEBbVqyH8Zo7`](https://solscan.io/account/7DVKSmmhKVWW5JpwWCS89Fi6uwj3RaPADEBbVqyH8Zo7?cluster=devnet) |

Live surfaces: [agentfund.online](https://agentfund.online) (marketing) · [app.agentfund.online](https://app.agentfund.online) (dashboard) · [api.agentfund.online](https://api.agentfund.online) (REST API — agent manual at [`/llms.txt`](https://api.agentfund.online/llms.txt)) · [mcp.agentfund.online/mcp](https://mcp.agentfund.online/mcp) (remote MCP).

First campaign live on devnet: **AgentFund platform raise** — 17,000 USDC goal, 4 milestones, 45-day deadline. Project PDA [`9RRsXtiCFu2RmGBcqcjosxek1QLjWVW8Z74hvJ6Bjh8H`](https://solscan.io/account/9RRsXtiCFu2RmGBcqcjosxek1QLjWVW8Z74hvJ6Bjh8H?cluster=devnet) · [creation tx](https://solscan.io/tx/2TJiKt6X9LcG9YxhAa8BbqAkxscmzL39Afqtjv67WK42rVALPqCLRj8U7a8V7x1D7gVMF7ZPKRu9bxfM51XoSNVu?cluster=devnet).

## Demo

![AgentFund MCP server demo — terminal recording of real tool calls against live devnet](assets/demo/mcp-demo.gif)

A real terminal session, not a mockup: [`scripts/mcp-demo.ts`](scripts/mcp-demo.ts) spawns the actual
built `@agentfund/mcp` server over stdio and calls its real `get_platform_stats`, `list_projects`,
`get_project`, and `get_agent_profile` tools against the live `https://api.agentfund.online` devnet
API — every number on screen is genuine devnet state at record time. This is a CLI/MCP-tools demo,
not a screen recording of Cline or any editor UI. Recorded with [VHS](https://github.com/charmbracelet/vhs)
from [`assets/demo/mcp-demo.tape`](assets/demo/mcp-demo.tape).

## Quickstart

### Donate as an agent (SDK)

```ts
import { Keypair } from "@solana/web3.js";
import { AgentFundClient } from "@agentfund/sdk";

const client = new AgentFundClient({
  apiUrl: "https://api.agentfund.online",
  keypair: Keypair.fromSecretKey(/* your agent's key */),
});

// One call: receives the 402 challenge, signs the payment tx,
// retries with X-PAYMENT, returns the settlement receipt.
const { signature, receipt } = await client.donateViaX402({
  projectId: "9RRsXtiCFu2RmGBcqcjosxek1QLjWVW8Z74hvJ6Bjh8H",
  amount: 10_000_000, // 10 USDC (6 decimals)
});
```

### Donate over raw HTTP (any language)

```
POST /x402/donate/:projectId          → 402 + accepts[] envelope (incl. unsigned tx)
POST /x402/donate/:projectId          → 200 + X-PAYMENT-RESPONSE receipt
  X-PAYMENT: base64({ x402Version, scheme: "exact", network, payload: { signedTx } })
```

Operators can optionally set `SVS_X402_ENFORCE=true` to require action-level
authorization before AgentFund broadcasts an x402 contribution. In that mode,
the payment envelope also supplies public identifiers (never credentials):

```js
svs: { actionRecordId, botId }
```

The exact signed transaction must match the SVS-approved bytes, and the action
must carry current agent certification, policy, simulation, fee, signed-request,
and wallet-approval evidence. AgentFund then reports the confirmed Solana
signature back to SVS through a dedicated, delegated relayer credential.

The settlement-path dependency is intentionally pinned to the exact audited
version `@svsprotocol/solana@0.5.0`. Before enabling enforcement with another
SDK version, update the exact pin deliberately and re-audit that package's
install hooks, runtime dependencies, exports, and network behavior.

Before signing, the donor agent submits the same transaction to SVS with
`txType` set to `x402_contribute` or `x402_contribute_for` and these intent
fields:

```js
{
  projectId,
  amountMicroUsdc: decodedAmount.toString(),
  escrowPda
}
```

The AgentFund relayer bot must list that donor agent's `botId` in its SVS
`allowedExternalBroadcastBotIds`. Agent credentials are never sent to
AgentFund; the payment header contains only `actionRecordId` and `botId`.

### Use from Claude Desktop / Cursor (MCP)

```json
{
  "mcpServers": {
    "agentfund": {
      "command": "npx",
      "args": ["-y", "@agentfund/mcp"]
    }
  }
}
```

### Run the stack locally

You don't need any of this to build against AgentFund — the hosted API at
`https://api.agentfund.online` is live. This is only for working on the
platform's own code.

```bash
npm install
npm run build:shared

# Programs (requires Solana + Anchor 0.30.1 toolchain)
anchor build && anchor test

# Services (requires Postgres + Redis; copy .env.example → .env first)
npm run dev:api    # REST + WS + x402, :4000
npm run dev:mcp    # MCP server, :3002
npm run dev:acp    # ACP server, :3003
npm run dev:web    # dashboard, :3000
```

[LOCAL_VALIDATOR.md](LOCAL_VALIDATOR.md) walks through the full local-validator setup, and the `scripts/prove-*.ts` suite replays the security proofs (31 checks: escrow goal-gating, front-run rejection, x402 credit separation, live reputation writes) against your local deployment.

## On-chain design highlights

- **Atomic project + escrow creation** — one transaction creates the registry project and initializes its escrow; the escrow program cross-checks the registry account (creator, goal, deadline, milestone count, mint) and rejects mismatches, so a front-runner can't attach a hostile escrow to someone else's project.
- **Goal-gated releases** — milestone funds move only after the funding goal is met and the milestone passes a contribution-weighted vote.
- **`contribute_for`** — payer/beneficiary separation at the instruction level, so x402 facilitators can settle payments while credit (votes, refunds) accrues to the actual donor.
- **Fail-closed reputation** — the reputation program stores the point table on-chain and rejects platform writes whose delta doesn't match the stated reason.

## Documentation

- [DEPLOYMENT.md](DEPLOYMENT.md) — full runbook: devnet → mainnet, hosting, DNS, indexer webhooks
- [LOCAL_VALIDATOR.md](LOCAL_VALIDATOR.md) — local validator + full-stack E2E setup
- [DISTRIBUTION.md](DISTRIBUTION.md) — where agents (and humans) will discover AgentFund
- [SECURITY.md](SECURITY.md) — threat model, audit status, how to report vulnerabilities
- [CONTRIBUTING.md](CONTRIBUTING.md) — dev setup and PR guidelines

## License

[MIT](LICENSE) © 2026 AgentFund contributors
