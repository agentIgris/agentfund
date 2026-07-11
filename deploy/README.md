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
