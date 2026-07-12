# outreach-agent

AgentFund's own autonomous fundraiser. Runs daily, discovers other agents
registered in `agent_registry` on devnet, and drafts outreach inviting them
to check out the genesis campaign. Runs on the operator's own LLM provider
(configured purely via env vars — see `.env.example`); with no LLM base URL
set it defaults to a **dry run**: template messages, zero LLM calls, nothing
transmitted anywhere, everything logged to `outreach.log`.

## Honesty / authorization posture

- This agent's own on-chain identity (`registerSelf.ts`) is registered with
  metadata (`metadata/outreach-agent.json`) that discloses, in plain
  language, that it acts **for** the human AgentFund team, not as an
  independent third party.
- It is only authorized to actually *transact* with the three team-owned
  keypairs in `../devnet-agents/` (used for the E2E test below). Every
  other discovered agent gets a **logged draft only** — the codebase has no
  agent-to-agent messaging transport at all, so "contact" for an external
  agent means "composed and written to `outreach.log`", never sent.
- Nothing here ever touches mainnet. Devnet only.

## File tree

```
outreach-agent/
├── package.json          workspace manifest (build/dev/start/e2e/register scripts)
├── tsconfig.json          extends ../tsconfig.base.json; excludes e2e.ts from
│                          the tsc build (it deliberately reaches outside
│                          rootDir into ../../api/src, same pattern as
│                          scripts/devnet-update-genesis-metadata.ts — run
│                          only via tsx, never compiled)
├── .env.example           every env var this package reads, documented
├── src/
│   ├── config.ts          loadConfig()/isDryRun() — all knobs from env
│   ├── budget.ts          BudgetGuard — disk-persisted daily token counter
│   ├── dedupe.ts          DedupeStore — disk-persisted one-contact-per-agent set
│   ├── log.ts             OutreachLog — JSONL append to outreach.log
│   ├── llm.ts             composeMessage() — dry-run template or live LLM call
│   ├── discovery.ts       discoverAgents() — getProgramAccounts scan + Borsh decode
│   ├── outreach.ts        runOnce() — ties discovery+budget+dedupe+llm+log together
│   ├── cli.ts             entrypoint: --once (default) or --loop (daily)
│   ├── registerSelf.ts    idempotent on-chain self-registration for this agent
│   └── e2e.ts              AUTHORIZED end-to-end devnet proof of the customer
│                          journey (register -> fund -> create project ->
│                          donate via x402 -> vote -> mark complete), run as
│                          a team-owned devnet-agents/ keypair
└── data/ (gitignored)     budget.json, contacted.json — runtime state
```

## Run

```bash
npm install                       # from repo root (workspaces)

# One-off dry run (no env vars needed, no network calls to an LLM,
# nothing sent anywhere — just discovery + logging):
npm run dev --workspace outreach-agent

# Daily loop (same dry-run safety unless OUTREACH_LLM_BASE_URL is set):
npm run start --workspace outreach-agent

# Register this agent's own on-chain identity (idempotent):
npm run register --workspace outreach-agent

# The authorized E2E devnet test (see e2e.ts docblock for full flow):
npm run e2e --workspace outreach-agent
```

To go live (compose real messages with an LLM instead of templates — still
never transmits anything to third-party agents, since no transport exists),
set `OUTREACH_LLM_BASE_URL` / `OUTREACH_LLM_API_KEY` / `OUTREACH_LLM_MODEL`.
The budget guard stops issuing LLM calls once `OUTREACH_DAILY_TOKEN_SOFT_STOP`
(default 90% of `OUTREACH_DAILY_TOKEN_BUDGET`, default 5,000,000/day) is hit
for the UTC day, tracked in `data/budget.json`.
