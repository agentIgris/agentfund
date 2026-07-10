# @agentfund/acp

ACP (Agent Communication Protocol, IBM ACP open REST pattern) server for
[AgentFund](../README.md) — exposes fundraising as 4 delegate-able agents that any
ACP-compatible peer agent can commission as if hiring a contractor, without touching
Solana, IPFS, or the REST API directly.

This server is a **thin client** over `@agentfund/api` (`API_BASE_URL`): it never signs
or broadcasts a Solana transaction. Every mutating agent returns an **unsigned** base64
transaction for whoever controls the configured relay wallet (`ACP_API_TOKEN`) to sign
and submit via `POST {API_BASE_URL}/tx/send` — the same sign-locally pattern used
throughout the platform (see `../mcp/README.md`'s "sign-locally" section for the
mechanics).

## The 4 delegate-able agents

| `agent_id` | async | input | output |
|---|---|---|---|
| `FundRaisingAgent` | true | `{ title, description, goal_usdc, milestones[], category?, deadline_days }` | `{ project_id, project_url, unsigned_tx, solscan_url }` |
| `ProjectEvaluatorAgent` | false | `{ project_id }` | `{ score, recommendation, risk_flags[], on_chain_verified }` |
| `DonationAgent` | false | `{ project_id, amount, token: "SOL" \| "USDC" }` | `{ unsigned_tx, expected_sig, confirmation_url }` |
| `MonitorAgent` | true | `{ project_id, events: ("milestone"\|"goal_reached"\|"vote"\|"refund")[] }` | `stream<AgentEvent>` (no single final output) |

`milestones[]` entries are `{ description, amount_usdc }`. See `src/schemas.ts` for the
full zod definitions (the runtime source of truth) and `src/manifests/agents.ts` /
`src/manifests/agents.yaml` for the JSON-Schema mirror served by `GET /agents`.

## REST surface (IBM ACP open REST pattern)

```
GET  /agents             -> { agents: AgentManifest[] }
POST /runs                  { agent_id, input } -> creates a run
                             - sync agents (ProjectEvaluatorAgent, DonationAgent)
                               respond inline, already "complete"/"failed"
                             - async agents (FundRaisingAgent, MonitorAgent)
                               respond immediately with status "running" + run_id
GET  /runs/:id           -> current run snapshot { run_id, agent_id, status, input, output?, error?, created_at, updated_at }
GET  /runs/:id/events    -> SSE stream of RunEvents:
                               { status: "running", output_chunk?: ... }
                               { status: "complete", output: ... }
                               { status: "failed", error: "..." }
                               { status: "cancelled" }
GET  /health              -> { ok: true }
```

`GET /runs/:id/events` replays every buffered event for the run before streaming new
ones, so connecting a few seconds after `POST /runs` doesn't miss anything (buffer is
capped at 200 events per run — see `src/runs/run-store.ts`).

## Run store

Runs live in an in-memory `Map<string, RunRecord>` (`src/runs/run-store.ts`) with a
periodic TTL sweep that evicts *terminal* (complete/failed/cancelled) runs after
`ACP_RUN_TTL_MS` (default 30 min). This works for exactly one server process.

**Production swap: Redis.** To run this horizontally behind a load balancer:
1. Replace the `Map` with a Redis hash/JSON value per run key so any instance can read a
   run regardless of which instance created it.
2. Replace the per-run `EventEmitter` + history array with a Redis Stream per run
   (`XADD agentfund:acp:run:<id> ...`) — durable, replayable history *and* live fan-out
   (`XREAD BLOCK`) in one primitive, mirroring `api/src/services/broker.ts`'s pattern for
   WS/SSE fan-out.
3. TTL cleanup becomes `EXPIRE run:<id> <ttlSeconds>` at write time instead of the manual
   sweep interval.
4. Cancellation (currently an `AbortController` per run) becomes a small "cancelled" flag
   in the Redis run record, polled or pushed the same way.

See the doc comment at the top of `src/runs/run-store.ts` for the full detail.

## Curl walkthrough

Assumes the server is running locally on port 3003 (`npm run dev --workspace acp`) and
`API_BASE_URL` points at a running `@agentfund/api` instance. Set `ACP_API_TOKEN` first
for the two agents that mutate state (`FundRaisingAgent`, `DonationAgent`) — obtain it via
the platform's normal Solana-keypair auth flow (`GET /auth/challenge` +
`POST /auth/verify`) for whichever wallet acts as AgentFund's relay agent.

### List the agents

```bash
curl -s http://localhost:3003/agents | jq
```

### FundRaisingAgent (async)

```bash
RUN=$(curl -s -X POST http://localhost:3003/runs \
  -H 'content-type: application/json' \
  -d '{
    "agent_id": "FundRaisingAgent",
    "input": {
      "title": "Open-source Solana indexer",
      "description": "Building a faster Helius-alternative indexer for AI agents.",
      "goal_usdc": 25000,
      "milestones": [
        { "description": "Prototype + design doc", "amount_usdc": 5000 },
        { "description": "Beta release",           "amount_usdc": 12000 },
        { "description": "Mainnet launch",          "amount_usdc": 8000 }
      ],
      "category": "infra",
      "deadline_days": 60
    }
  }')
echo "$RUN" | jq
RUN_ID=$(echo "$RUN" | jq -r .run_id)

# Poll until complete:
curl -s http://localhost:3003/runs/$RUN_ID | jq

# Or stream it (recommended for async agents):
curl -s -N http://localhost:3003/runs/$RUN_ID/events
```

The completed run's `output` is `{ project_id, project_url, unsigned_tx, solscan_url }`.
Base64-decode `unsigned_tx`, sign it with the relay wallet's keypair, and submit via
`POST {API_BASE_URL}/tx/send`.

### ProjectEvaluatorAgent (sync)

```bash
curl -s -X POST http://localhost:3003/runs \
  -H 'content-type: application/json' \
  -d '{
    "agent_id": "ProjectEvaluatorAgent",
    "input": { "project_id": "<project PDA pubkey from FundRaisingAgent above>" }
  }' | jq
```

Responds inline (HTTP 200) with `{ run_id, status: "complete", output: { score,
recommendation, risk_flags, on_chain_verified }, ... }`. See the scoring rubric
documented at the top of `src/agents/evaluator.ts`.

### DonationAgent (sync)

```bash
curl -s -X POST http://localhost:3003/runs \
  -H 'content-type: application/json' \
  -d '{
    "agent_id": "DonationAgent",
    "input": { "project_id": "<project PDA pubkey>", "amount": 100, "token": "USDC" }
  }' | jq
```

`output.unsigned_tx` is the unsigned `contribute` transaction; `expected_sig` is always
`null` (a signature can't be known before signing); `confirmation_url` is a template —
substitute the real signature after `POST {API_BASE_URL}/tx/send` and `GET` it to poll
confirmation.

### MonitorAgent (async, streaming)

```bash
RUN=$(curl -s -X POST http://localhost:3003/runs \
  -H 'content-type: application/json' \
  -d '{
    "agent_id": "MonitorAgent",
    "input": {
      "project_id": "<project PDA pubkey>",
      "events": ["milestone", "goal_reached", "vote", "refund"]
    }
  }')
RUN_ID=$(echo "$RUN" | jq -r .run_id)

# Stays open, printing a "running" RunEvent with output_chunk: AgentEvent
# for every matching event on the project, until you Ctrl-C (which closes
# the SSE connection and cancels the run server-side):
curl -s -N http://localhost:3003/runs/$RUN_ID/events
```

See the event-filter -> WebSocket-channel/type mapping documented at the top of
`src/agents/monitor.ts` — in particular, `"refund"` maps to the indexer's
`project.status_changed` event with `data.status === "Failed"` (there is no dedicated
`"refund"` type in the platform's WebSocket protocol today), re-labelled to `type:
"refund"` in the emitted `AgentEvent` so it matches what callers asked for.

## Config

All config is read from env (see [`.env.example`](./.env.example) and the repo-root
[`.env.example`](../.env.example)):

| Var | Default | Meaning |
|---|---|---|
| `ACP_HOST` | `0.0.0.0` | Bind host |
| `ACP_PORT` | `3003` | Bind port |
| `CORS_ORIGIN` | `*` | Comma-separated allowed origins, or `*` |
| `API_BASE_URL` | `http://localhost:4000` | Base URL of the `@agentfund/api` REST server this ACP server proxies to |
| `API_WS_URL` | derived from `API_BASE_URL` | Override for the WS URL `MonitorAgent` connects to |
| `ACP_API_TOKEN` | _(unset)_ | Bearer JWT for AgentFund's relay wallet — required by `FundRaisingAgent` and `DonationAgent` |
| `FRONTEND_BASE_URL` | `https://predictbgmi.fun` | Used to build `FundRaisingAgent`'s `project_url` |
| `SOLSCAN_BASE_URL` | `https://solscan.io` | Used to build `*_url` fields pointing at a block explorer |
| `ACP_RUN_TTL_MS` | `1800000` (30 min) | How long a terminal run is kept before GC |
| `ACP_RUN_SWEEP_INTERVAL_MS` | `60000` | How often the TTL sweep runs |
| `ACP_SSE_HEARTBEAT_MS` | `25000` | SSE heartbeat comment interval (keeps the stream alive through proxies) |
| `SOLANA_CLUSTER` / `SOLANA_RPC_URL` | `devnet` / devnet RPC | Only used to label `solscan_url` with `?cluster=devnet` when not `mainnet-beta` — this server never signs/broadcasts |

## Build & run

```bash
npm run build --workspace acp   # tsc -> dist/
npm run start --workspace acp   # node dist/index.js

npm run dev --workspace acp     # tsx watch src/index.ts (no build step needed)

npm run gen:manifest --workspace acp   # regenerate src/manifests/agents.yaml from agents.ts
```

## Architecture notes

- `src/index.ts` — Fastify bootstrap: CORS, `GET /agents`, the `/runs` routes, `/health`,
  graceful shutdown (stops the run store's TTL sweep).
- `src/agents/` — one file per delegate-able agent, each exporting an `AgentDefinition`
  (`{ manifest, inputSchema, execute }`); `src/agents/index.ts` is the `agent_id ->
  AgentDefinition` registry `POST /runs` looks up.
- `src/runs/run-store.ts` — the in-memory run store + pub/sub described above.
- `src/runs/executor.ts` — starts a run for an `AgentDefinition`, branching on
  `manifest.async` (sync: await to completion before responding; async: emit "running"
  and return immediately, with completion arriving via SSE/polling).
- `src/routes/agents.ts`, `src/routes/runs.ts` — the 4 HTTP routes.
- `src/api-client.ts` — the only place that calls `fetch` against `@agentfund/api`.
- `src/schemas.ts` / `src/types.ts` — zod input schemas (runtime source of truth) and the
  shared `RunEvent`/`RunRecord`/`AgentManifest`/`AgentDefinition`/`RunContext` types.
- `src/manifests/agents.ts` / `agents.yaml` — the manifest served by `GET /agents`, plus
  its static YAML mirror (regenerate via `scripts/gen-manifest.ts`).

## TODOs / known limitations

- `ACP_API_TOKEN` is a single static relay-wallet bearer token for the whole server —
  there's no per-ACP-caller identity or multi-tenant credential story yet (matches the
  spec's framing of AgentFund as a single delegate-able peer agent, not a multi-user
  gateway).
- `MonitorAgent`'s `"refund"` event filter is inferred from the indexer's generic
  `project.status_changed` event (see `src/agents/monitor.ts`) because the platform's
  WebSocket protocol has no dedicated `"refund"` event type today — if one is added
  upstream, update the mapping there.
- The run store is single-process in-memory; see the Redis swap plan above before
  deploying more than one ACP server instance behind a load balancer.
