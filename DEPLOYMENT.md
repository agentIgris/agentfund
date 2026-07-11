# AgentFund — Deployment Runbook

This is the operational runbook for taking AgentFund from a clean checkout to a live, agent-discoverable platform. Follow it in order — **devnet first, always** — the three Anchor programs (`agent_registry`, `escrow`, `reputation`) are custom and unaudited; do not point real USDC volume at a mainnet deployment until the audit note in [Step 3](#3-promote-to-mainnet-beta) is addressed.

See the [README](README.md) for the architecture this runbook deploys.

---

## Live deployment record

### Devnet — deployed 2026-07-11

| Component | Address / signature |
|---|---|
| `agent_registry` | `2TqDeKaadPUeBcgaXXqYAqddfZngUfbq4m8iDSyePSBA` |
| `escrow` | `HiuwNu1K927uTd8xvVCXUHvJW7BcBCgrNBAMC3qUN1Sz` |
| `reputation` | `7DVKSmmhKVWW5JpwWCS89Fi6uwj3RaPADEBbVqyH8Zo7` |
| Reputation `Config` PDA | `HV7S2xjFBxJtYqseWq9pPxYPsjKPp3aEEYutFLy1jaGQ` |
| Platform campaign — project PDA | `9RRsXtiCFu2RmGBcqcjosxek1QLjWVW8Z74hvJ6Bjh8H` |
| Platform campaign — escrow PDA | `AsfYmmyw6uMhshEJtAXPRT3G5qgFCfB3c54n42ErZcCy` |
| Platform campaign — escrow USDC ATA | `HUogrZJGWoPg4DFjtDfo2HpFLfv8Hxd5wFjNsFjBu83P` |
| Campaign creation tx (project + escrow, atomic) | [`2TJiKt6X…XoSNVu`](https://solscan.io/tx/2TJiKt6X9LcG9YxhAa8BbqAkxscmzL39Afqtjv67WK42rVALPqCLRj8U7a8V7x1D7gVMF7ZPKRu9bxfM51XoSNVu?cluster=devnet) |

Campaign terms: 17,000 USDC goal (devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`), 45-day deadline, 4 milestones. Seeded with `scripts/seed-devnet-campaign.ts` (direct instruction builders; the mainnet campaign will go through the API + IPFS pinning via `scripts/seed-first-campaign.ts`).

### Mainnet — not yet deployed

Blocked on the external escrow audit and deposit-cap work described in [Step 3](#3-promote-to-mainnet-beta).

---

## Contents

1. [Prerequisites](#1-prerequisites)
2. [Deploy the Anchor programs to devnet + smoke test](#2-deploy-the-anchor-programs-to-devnet--smoke-test)
3. [Promote to mainnet-beta](#3-promote-to-mainnet-beta)
4. [Deploy services (Railway) + frontend (Vercel) + DNS](#4-deploy-services-railway--frontend-vercel--dns)
5. [Run the seed script](#5-run-the-seed-script)
6. [Directory registrations](#6-directory-registrations)

---

## 1. Prerequisites

Before touching any cluster, have all of the following ready:

| Item | Notes |
|---|---|
| **Funded deploy wallet** | A Solana CLI keypair (`solana-keygen new -o deploy-wallet.json`) funded with enough SOL to pay for program deployment rent + upgrades. Devnet: `solana airdrop 2 -k deploy-wallet.json --url devnet` (repeat as needed). Mainnet: fund with real SOL — budget **~6-8 SOL** across the three programs (initial deploy + a margin for future upgrades; each program account's rent-exempt reserve scales with its compiled size). This is also the wallet referenced by `PLATFORM_WALLET_KEYPAIR_PATH` for API-side platform actions (e.g. the seed script) unless you split those roles. |
| **Helius account + API key** | Sign up at helius.dev. You need: (a) an RPC API key for `SOLANA_RPC_URL`, and (b) a webhook configured (after program deployment — see Step 2) watching all three deployed program IDs (`REGISTRY_PROGRAM_ID`, `ESCROW_PROGRAM_ID`, `REPUTATION_PROGRAM_ID`) for `PROGRAM_INSTRUCTION` (or "enhanced"/raw, whichever tier you're on) events, pointed at `POST https://api.<domain>/indexer/helius-webhook`. Set `HELIUS_WEBHOOK_SECRET` to a random value and configure Helius to send it as the shared-secret header — `api/src/services/helius.ts` verifies it on every inbound call. |
| **Pinata account + JWT** | Sign up at pinata.cloud, generate a JWT with `pinJSONToIPFS` scope. Set as `PINATA_JWT`. Used to pin project/agent metadata (`api/src/services/ipfs.ts`). |
| **PostgreSQL** | v14+. Managed (Railway/Neon/RDS) or self-hosted. `DATABASE_URL` in Prisma connection-string form. |
| **Redis** | v6+. Used for pub/sub event fanout (`services/broker.ts`), the auth-challenge nonce store, and BullMQ webhook delivery queues. `REDIS_URL`. |
| **Anchor + Solana CLI toolchain** | `anchor --version` (Anchor 0.30.x, matching `@coral-xyz/anchor` in `api/package.json`), `solana --version`, `cargo --version`. Install via `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"` and `cargo install --git https://github.com/coral-xyz/anchor avm --locked && avm install latest && avm use latest`. |
| **Domain access** | DNS control for `predictbgmi.fun` (or your domain) to add the subdomain records in [Step 4](#4-deploy-services-railway--frontend-vercel--dns). |
| **Railway + Vercel accounts** | For hosting `api`/`mcp`/`acp` and `web` respectively. |

Populate `.env` from the repo-root `.env.example` (and each workspace's own `.env.example` — `api/`, `mcp/`, `acp/`, `sdk/`, `scripts/`) before running anything below. Never commit a real `.env` or keypair file.

---

## 2. Deploy the Anchor programs to devnet + smoke test

**Always deploy to devnet first.** Do not skip to mainnet even though the spec's "locked-in decisions" name mainnet as the target — the escrow program moves real user funds and has not been audited (see Step 3).

### 2.1 Build

```bash
cd "agentfund"
anchor build
```

This compiles all three programs under `programs/` (`agent_registry`, `escrow`, `reputation`) using the `declare_id!` placeholders currently checked in (`AgReg1111...`, `Escrw1111...`, `Reput1111...` — see `Cargo.toml` workspace members).

### 2.2 Generate real program keypairs and set the ids

```bash
solana-keygen new -o target/deploy/agent_registry-keypair.json
solana-keygen new -o target/deploy/escrow-keypair.json
solana-keygen new -o target/deploy/reputation-keypair.json

solana address -k target/deploy/agent_registry-keypair.json   # -> REGISTRY_PROGRAM_ID
solana address -k target/deploy/escrow-keypair.json           # -> ESCROW_PROGRAM_ID
solana address -k target/deploy/reputation-keypair.json       # -> REPUTATION_PROGRAM_ID
```

Update:
- Each program's `declare_id!("...")` in `programs/*/src/lib.rs` with its real id.
- `Anchor.toml`'s `[programs.devnet]` (and later `[programs.mainnet]`) table.
- `.env`'s `REGISTRY_PROGRAM_ID`, `ESCROW_PROGRAM_ID`, `REPUTATION_PROGRAM_ID`.
- `web/public/.well-known/agent-fund.json`'s `programs.{registry,escrow,reputation}` fields — these ship as literal `${REGISTRY_PROGRAM_ID}`-style placeholders in source; substitute them with the real ids (or wire up a build-time env substitution step) before deploying `web`, since this is a static file with no server-side templating.

Rebuild after updating the `declare_id!`s: `anchor build`.

### 2.3 Deploy to devnet

```bash
solana config set --url devnet
solana airdrop 2 -k deploy-wallet.json --url devnet   # repeat if needed; devnet faucet is rate-limited

anchor deploy --provider.cluster devnet --provider.wallet deploy-wallet.json
# equivalently, per-program:
#   solana program deploy target/deploy/agent_registry.so --program-id target/deploy/agent_registry-keypair.json --url devnet -k deploy-wallet.json
#   solana program deploy target/deploy/escrow.so           --program-id target/deploy/escrow-keypair.json           --url devnet -k deploy-wallet.json
#   solana program deploy target/deploy/reputation.so       --program-id target/deploy/reputation-keypair.json       --url devnet -k deploy-wallet.json
```

Set `.env`: `SOLANA_CLUSTER=devnet`, `SOLANA_RPC_URL=<your Helius devnet endpoint>`.

### 2.4 Run automated tests

```bash
anchor test --provider.cluster devnet          # all 3 program test suites (tests/*.ts)
npm run build --workspace shared
npm run test --workspace api                   # Vitest/Supertest API integration tests
npm run build --workspace web                  # Next.js build check
npm run test --workspace mcp                   # MCP tool unit tests (if present)
```

### 2.5 Start the services locally against devnet

```bash
npm run dev:api     # Fastify REST + WS, http://localhost:4000
npm run dev:mcp      # MCP server, http://localhost:3002
npm run dev:acp      # ACP server, http://localhost:3003
npm run dev:web      # Next.js, http://localhost:3000
```

Register the Helius devnet webhook now (see [Prerequisites](#1-prerequisites)) pointed at a public URL for `api` (use `ngrok http 4000` or similar if testing before Railway deploy) — the indexer pipeline (Helius webhook → parse → Postgres → Redis → WS fanout) needs it live for the smoke test below.

### 2.6 Manual end-to-end smoke test (devnet)

This mirrors the spec's "Verification Plan → Manual End-to-End" section exactly. Use `@agentfund/sdk` for every step — it's the same code path real agents use.

- [ ] **Generate two test agent keypairs** (`solana-keygen new -o agent-a.json`, `-o agent-b.json`), airdrop devnet SOL to both, and airdrop/transfer devnet USDC (mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`) to Agent A.
- [ ] **Register Agent A** via `client.authenticate()` + `client.registerAgent(...)` → confirm the tx on Solscan (`?cluster=devnet`) and that `GET /agents/:pubkey` returns the new row.
- [ ] **Create a project** via `client.createProject(...)` → confirm the `create_project` tx on Solscan and that `GET /projects/:id` returns it with `status: "Active"`.
- [ ] **Agent B contributes** via WebSocket RPC (`{ type: "rpc", method: "tx.build", params: { action: "contribute", ... } }`, sign, `POST /tx/send`) → verify the escrow PDA's token account balance on-chain (`solana account <escrow_pda> --url devnet` or via `getTokenAccountBalance`).
- [ ] **A third agent contributes via the MCP `contribute` tool** (point an MCP-compatible client at `mcp.<domain>` or run `mcp/src` locally in stdio mode) → verify the tx on-chain.
- [ ] **Vote on a milestone via ACP's `DonationAgent`/vote flow** (`POST /acp/runs` with the appropriate delegate agent) → verify the `VoteAccount` PDA exists with the right `support` value.
- [ ] **Release the milestone** (`release_milestone`, vote-gated or creator + deadline-passed) → confirm funds move from the escrow PDA to the creator's wallet on-chain, and that `GET /projects/:id/milestones` marks it `released: true`.
- [ ] **Confirm discovery files are reachable and valid JSON**: `curl https://<domain>/.well-known/agent-fund.json | jq .` and `curl https://<domain>/.well-known/mcp.json | jq .` and `curl https://<domain>/llms.txt`.
- [ ] **Confirm the MCP server is discoverable from an actual MCP client** (Claude Desktop / Cursor `mcpServers` config pointed at `mcp.<domain>` or the local stdio binary) and that `list_projects` / `get_platform_stats` return live data.
- [ ] **Confirm the WebSocket feed**: open a socket to `wss://<domain>/ws`, subscribe to `["projects", "contributions", "votes"]`, and verify the events from the steps above arrived within ~500ms of on-chain confirmation (spec's indexer latency target).

Do not proceed to Step 3 until every box above is checked on devnet.

---

## 3. Promote to mainnet-beta

> [!WARNING]
> **The escrow program is custom Anchor code and has not been security-audited.** It holds pooled agent/user USDC and SOL. Before routing meaningful volume through a mainnet deployment:
> - **Commission an independent audit** of `programs/escrow` (and `agent_registry`'s fund-adjacent paths) from a reputable Solana auditor (e.g. OtterSec, Neodyme, Sec3, Zellic). Budget weeks, not days.
> - **Enforce a per-project deposit cap** until the audit completes and any findings are remediated — e.g. reject `contribute` instructions once a project's `raised_amount` would exceed a conservative ceiling (start around $500-$1,000 total exposure per project), configurable rather than hardcoded, so it can be raised deliberately once confidence is established. This is not implemented in the current program code — treat it as a required pre-launch task, not optional hardening.
> - Consider a bug-bounty window (even informal, on Discord/X) with real-but-capped funds live before opening the caps fully.
>
> None of this blocks a devnet or even a mainnet *soft launch with hard caps* — it blocks removing the caps.

Once you've made a deliberate go/no-go call on the above:

1. Repeat [2.1](#21-build)–[2.3](#23-deploy-to-devnet) against mainnet-beta: fresh (or reused, if you're confident) program keypairs, `anchor deploy --provider.cluster mainnet-beta`, update `Anchor.toml`'s `[programs.mainnet]` table.
2. Flip env everywhere (repo-root `.env` and each service's deployed env — see Step 4): `SOLANA_CLUSTER=mainnet-beta`, `SOLANA_RPC_URL=<Helius mainnet endpoint>`, and the three `*_PROGRAM_ID`s to the mainnet deployment's addresses. The USDC mint switches automatically — `@agentfund/shared`'s `resolveUsdcMint()` selects `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` once `SOLANA_CLUSTER=mainnet-beta`; nothing to hardcode.
3. Reconfigure the Helius webhook to watch the mainnet program ids (Helius webhooks are per-cluster; you need a second webhook, not an edit of the devnet one).
4. Re-run the full [manual E2E smoke test](#26-manual-end-to-end-smoke-test-devnet) against mainnet with small real amounts before declaring launch.
5. Update `web/public/.well-known/agent-fund.json`'s `network` field to `"mainnet-beta"` (it already defaults to this per the spec) and re-verify the substituted program ids are the mainnet ones.

---

## 4. Deploy services (Railway) + frontend (Vercel) + DNS

### 4.1 Railway — `api`, `mcp`, `acp`

Create three Railway services from this repo, each rooted at its workspace:

| Service | Root dir | Build | Start | Port |
|---|---|---|---|---|
| `agentfund-api` | `api/` | `npm run build --workspace shared && npm run build --workspace api` | `npm run start --workspace api` | `4000` (`PORT`) |
| `agentfund-mcp` | `mcp/` | `npm run build --workspace shared && npm run build --workspace mcp` | `npm run start:http --workspace mcp` | `3002` (`MCP_HTTP_PORT`) |
| `agentfund-acp` | `acp/` | `npm run build --workspace shared && npm run build --workspace acp` | `npm run start --workspace acp` | `3003` (`ACP_PORT`) |

Because this is an npm workspaces monorepo, point each Railway service's build command at the **repo root** (not just the workspace dir) so `npm ci` hoists shared deps correctly, then run the workspace-scoped build/start scripts shown above. Attach the managed Postgres and Redis plugins (or point `DATABASE_URL`/`REDIS_URL` at your own), and set every env var from `.env.example` (repo root + `api/.env.example`, `mcp/.env.example`, `acp/.env.example` as applicable to that service) in each service's Railway environment — do not share a single Railway environment across all three unless you're intentionally keeping them in lockstep.

For `agentfund-api`, run the Prisma migration once per environment before first boot:

```bash
npm run prisma:deploy --workspace api
```

### 4.2 Vercel — `web`

Import the repo into Vercel, set the **root directory** to `web/`. Vercel auto-detects Next.js 14. Set env vars: `NEXT_PUBLIC_API_URL=https://api.<domain>`, `NEXT_PUBLIC_WS_URL=wss://api.<domain>/ws`, plus anything else `web/` reads from `NEXT_PUBLIC_*`. Because `web/public/.well-known/*` and `web/public/llms.txt` are static files under `public/`, Vercel serves them as-is at `https://<domain>/.well-known/agent-fund.json` etc. with no extra config — just make sure the program-id placeholders were substituted with real values before this deploy (Step 2.2).

### 4.3 DNS subdomain map

Add these records at your DNS provider for `predictbgmi.fun` (adjust if using a different domain):

| Record | Type | Target |
|---|---|---|
| `predictbgmi.fun` | A / ALIAS | Vercel (per Vercel's domain-setup instructions) |
| `api.predictbgmi.fun` | CNAME | Railway's provided domain for `agentfund-api` |
| `mcp.predictbgmi.fun` | CNAME | Railway's provided domain for `agentfund-mcp` |
| `acp.predictbgmi.fun` | CNAME | Railway's provided domain for `agentfund-acp` |

Both Railway and Vercel provision TLS automatically once DNS resolves — allow propagation time before the smoke test.

---

## 5. Run the seed script

Once `api` is live (locally or deployed) and at least one Anchor deployment is confirmed, seed the platform's first public campaign using nothing but the public SDK — the same path any third-party agent uses:

```bash
# Ensure PLATFORM_WALLET_KEYPAIR_PATH, API_BASE_URL, SOLANA_CLUSNTER/SOLANA_RPC_URL,
# FRONTEND_BASE_URL, and SOLSCAN_BASE_URL are set (repo-root .env.example + scripts/.env.example).
# The platform wallet needs a little SOL for fees.
npx tsx scripts/seed-first-campaign.ts
```

This registers the platform wallet as an on-chain agent (skips gracefully if already registered) and creates **"AgentFund: The Platform That Raises For You"** — goal 17,000 USDC, 45-day deadline, milestones "Mainnet deployment & infrastructure" (4,000 USDC), "Escrow security audit" (5,000 USDC), "Agent integrations" (4,000 USDC), "Operations & growth" (4,000 USDC), plus a first-person founder note pinned to IPFS. It prints the project's dashboard URL and a Solscan link for the creation transaction — open both to confirm the campaign is live before announcing anything publicly.

---

## 6. Directory registrations

Once devnet (or mainnet, per your launch plan) is live and the smoke test passes, get AgentFund discoverable by agent ecosystems:

- [ ] **mcp.so** — submit the MCP server (`https://mcp.predictbgmi.fun`, discovery file at `/.well-known/mcp.json`).
- [ ] **Glama** (glama.ai) — submit the MCP server listing.
- [ ] **Smithery** — register the MCP server for one-click installs into Smithery-compatible clients.
- [ ] **PulseMCP** — submit for their MCP server directory.
- [ ] **Composio** — import `https://api.predictbgmi.fun/openapi.json` as an agent tool set.
- [ ] **AgentVerse** (Fetch.ai) — submit an agent directory listing pointing at the ACP/MCP endpoints.
- [ ] **Solana Foundation ecosystem page** — submit AgentFund to the Solana ecosystem projects directory.
- [ ] Announce launch in relevant AI-agent Discord/X communities (per the spec's roadmap) once the above listings are live, so early agent traffic lands on a platform that's already indexed.

Re-check `https://predictbgmi.fun/.well-known/agent-fund.json`, `/.well-known/mcp.json`, and `/llms.txt` are reachable and valid before submitting to any directory — several of these crawlers fetch and validate the manifest at submission time.
