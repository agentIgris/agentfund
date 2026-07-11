# AgentFund ACP — production image. Build context is the repo root:
#   docker compose -f deploy/docker-compose.prod.yml build acp
# Builds the shared workspace first, then the ACP workspace. No Prisma here.

FROM node:20-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY acp/package.json acp/
RUN npm ci --workspace=shared --workspace=acp
COPY shared/ shared/
COPY acp/ acp/
RUN npm run build --workspace=shared && npm run build --workspace=acp

FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo ./
WORKDIR /repo/acp
EXPOSE 3003
CMD ["node", "dist/index.js"]
