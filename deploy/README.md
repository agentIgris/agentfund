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
| Dashboard (Next.js)    | https://app.agentfund.online        | Deployed on Vercel                       |
| Landing page           | https://agentfund.online            | GitHub Pages (`main:/docs`)              |

`mcp` and `acp` run as additional services in `docker-compose.prod.yml`,
built from `deploy/mcp.Dockerfile` / `deploy/acp.Dockerfile` (same
workspace-aware multi-stage pattern as `deploy/api.Dockerfile`, minus
Prisma) and reverse-proxied by Caddy at `mcp.agentfund.online` /
`acp.agentfund.online`. Both talk to the API over the compose-internal
network at `http://api:4000` rather than the public hostname.
