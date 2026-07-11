# AgentFund API — production image. Build context is the repo root:
#   docker compose -f deploy/docker-compose.prod.yml build
# Builds the shared workspace first, then the API (prisma generate + tsc).

FROM node:20-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY api/package.json api/
RUN npm ci --workspace=shared --workspace=api
COPY shared/ shared/
COPY api/ api/
RUN npm run build --workspace=shared && npm run build --workspace=api

FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo ./
WORKDIR /repo/api
EXPOSE 4000
# Sync the schema, then start. db push (idempotent) instead of migrate
# deploy while the repo has no committed migrations directory yet.
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/index.js"]
