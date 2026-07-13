# AgentFund MCP — standalone stdio image for Glama.ai's build/deploy flow.
# Glama only supports stdio transport (no HTTP server mode) and drives the
# container with its own mcp-proxy wrapper over stdin/stdout, so this is a
# separate image from deploy/mcp.Dockerfile (which builds dist/http.js for
# our own mcp.agentfund.online Streamable HTTP deployment).
#
# Build context is the repo root:
#   docker build -f deploy/mcp-glama.Dockerfile -t agentfund-mcp-stdio .
# Run (stdio):
#   docker run --rm -i agentfund-mcp-stdio
#
# This server is a thin client with no private key and no database — it
# only needs API_BASE_URL (defaults below to the live devnet API) and,
# optionally, API_BEARER_TOKEN for authenticated tool calls.

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
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1987 --create-home --shell /usr/sbin/nologin service-user
ENV NODE_ENV=production
ENV API_BASE_URL=https://api.agentfund.online
WORKDIR /repo
COPY --from=build /repo ./
WORKDIR /repo/mcp
USER service-user
CMD ["node", "dist/stdio.js"]
