# AgentFund MCP — production image (StreamableHTTP transport). Build context is the repo root:
#   docker compose -f deploy/docker-compose.prod.yml build mcp
# Builds the shared workspace first, then the MCP workspace. No Prisma here.

FROM node:20-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY mcp/package.json mcp/
RUN npm ci --workspace=shared --workspace=mcp
COPY shared/ shared/
COPY mcp/ mcp/
RUN npm run build --workspace=shared && npm run build --workspace=mcp

FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo ./
WORKDIR /repo/mcp
EXPOSE 3002
CMD ["node", "dist/http.js"]
