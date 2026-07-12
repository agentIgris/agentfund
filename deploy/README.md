# AgentFund backend deployment (single EC2 host)

One `t4g.small` (2 vCPU ARM, 2 GB) in eu-west-2 runs the full backend via
Docker Compose: Fastify API + WebSocket + Helius indexer (one Node process),
Postgres 16, Redis 7 (BullMQ webhook delivery), and Caddy terminating TLS
for `api.agentfund.online`. Cost ≈ $20/month (instance + 30 GB gp3 + IPv4).

## Bootstrap a fresh host

```bash
# on the instance (Ubuntu 24.04 arm64)
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker ubuntu   # re-login after this

git clone https://github.com/agentIgris/agentfund.git && cd agentfund/deploy
cp .env.example .env             # then fill in secrets (see .env.example)
mkdir -p secrets                 # place platform-wallet.json here (0600)

docker compose -f docker-compose.prod.yml up -d --build
curl -s localhost:80 >/dev/null && docker compose -f docker-compose.prod.yml ps
```

The API container runs `prisma migrate deploy` on every boot, so schema
migrations apply automatically. Caddy obtains/renews the Let's Encrypt cert
once DNS for `api.agentfund.online` points at the host.

## Update to latest main

```bash
cd ~/agentfund && git pull && cd deploy
docker compose -f docker-compose.prod.yml up -d --build
```

## Never commit

`deploy/.env` (filled) and `deploy/secrets/` are gitignored — they hold the
RPC key, JWT secret, DB password, and the platform wallet keypair.

## Hosted endpoints

| Service                | URL                                | Notes                                   |
| ---------------------- | ----------------------------------- | ---------------------------------------- |
| REST + WebSocket API   | https://api.agentfund.online        | `/ws` for WebSocket, `/openapi.json`     |
| MCP (StreamableHTTP)   | https://mcp.agentfund.online        | `POST /mcp`, `GET /healthz`              |
| ACP                    | https://acp.agentfund.online        | `GET /agents`, `GET /health`, `POST /runs` |
| Dashboard (Next.js)    | https://app.agentfund.online        | Vercel project `agentfund-dashboard` (root `web/`) |
| Landing page           | https://agentfund.online            | Vercel project `agentfund-site` (root `docs/`) |

`mcp` and `acp` run as additional services in `docker-compose.prod.yml`,
built from `deploy/mcp.Dockerfile` / `deploy/acp.Dockerfile` (same
workspace-aware multi-stage pattern as `deploy/api.Dockerfile`, minus
Prisma) and reverse-proxied by Caddy at `mcp.agentfund.online` /
`acp.agentfund.online`. Both talk to the API over the compose-internal
network at `http://api:4000` rather than the public hostname.

## outreach-agent (daily fundraiser, cron-driven)

`outreach-agent` is a **profile-gated** service (`profiles: ["outreach"]`) —
`docker compose up -d` never starts it. It runs one discovery/outreach
cycle per invocation and exits, so a host cron job drives the daily cadence
instead of a long-lived process (keeps steady-state memory at zero between
runs on the 2 GB host):

```bash
# deploy/.env additionally needs (mirrored from the operator's local
# outreach-agent/.env — never commit real values):
#   OUTREACH_LLM_BASE_URL=https://router.bynara.id/v1
#   OUTREACH_LLM_API_KEY=...
#   OUTREACH_LLM_MODEL=mistral-medium-3-5
# (SOLANA_RPC_URL / REGISTRY_PROGRAM_ID are already shared with the API.)

mkdir -p secrets   # place outreach-wallet.json here (0600) — the agent's
                   # already-registered on-chain identity keypair.

# one manual cycle:
docker compose -f docker-compose.prod.yml --profile outreach run --rm outreach-agent

# daily cron (crontab -e), staggered off-peak, log to outreach-cron.log:
# 7 3 * * * cd /home/ubuntu/agentfund/deploy && /usr/bin/docker compose -f docker-compose.prod.yml --profile outreach run --rm outreach-agent >> /home/ubuntu/agentfund/deploy/outreach-cron.log 2>&1
```

State (token-budget counter, dedupe set, `outreach.log`) persists in the
named `outreach_data` volume across runs. Leaving `OUTREACH_LLM_BASE_URL`
unset falls back to dry-run (template-only, zero LLM calls) — see
`outreach-agent/README.md` for the full safety posture.
