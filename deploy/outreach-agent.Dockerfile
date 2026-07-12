# AgentFund outreach-agent — production image. Build context is the repo root:
#   docker compose -f deploy/docker-compose.prod.yml --profile outreach build outreach-agent
# Builds shared + sdk first, then the outreach-agent workspace. Runs one
# discovery/outreach cycle per invocation (`--once`); the daily cadence is
# driven by a host cron job (`docker compose --profile outreach run --rm
# outreach-agent`), not a long-lived process — keeps steady-state memory on
# the small EC2 host at zero between runs.
FROM node:20-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY sdk/package.json sdk/
COPY outreach-agent/package.json outreach-agent/
RUN npm ci --workspace=shared --workspace=sdk --workspace=outreach-agent
COPY shared/ shared/
COPY sdk/ sdk/
COPY outreach-agent/ outreach-agent/
RUN npm run build --workspace=shared && npm run build --workspace=sdk && npm run build --workspace=outreach-agent

FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo ./
WORKDIR /repo/outreach-agent
CMD ["node", "dist/cli.js", "--once"]
