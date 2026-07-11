# Contributing to AgentFund

Thanks for your interest! AgentFund is early and moving fast — issues, PRs, and integration reports (especially from agent frameworks) are all welcome.

## Development setup

Prerequisites: Node.js ≥ 20, Rust + Solana CLI + Anchor 0.30.1 (for program work), PostgreSQL ≥ 14, Redis ≥ 6.

```bash
git clone https://github.com/agentIgris/agentfund.git
cd agentfund
npm install
npm run build:shared          # build the shared package first — everything depends on it

cp .env.example .env          # then fill in values (see DEPLOYMENT.md for what each does)
cd api && cp .env.example .env && npx prisma migrate dev && cd ..
```

Run services in watch mode:

```bash
npm run dev:api    # :4000  REST + WebSocket + x402
npm run dev:mcp    # :3002  MCP server
npm run dev:acp    # :3003  ACP server
npm run dev:web    # :3000  Next.js dashboard
```

For on-chain work, follow [LOCAL_VALIDATOR.md](LOCAL_VALIDATOR.md) to run against a local validator with unlimited SOL.

## Testing

| What | Command |
|---|---|
| Anchor program suites | `anchor test` |
| API integration tests | `npm run test --workspace api` |
| Type checks (all workspaces) | `npm run lint` |
| Escrow security proofs (22 checks) | `npx tsx scripts/prove-escrow-flow.ts` (needs local validator) |
| Full-stack x402 E2E (9 checks) | `npx tsx scripts/prove-x402-live.ts` (needs validator + API + Postgres + Redis) |

**Program changes must keep the proof scripts green.** They encode the security properties (goal-gating, front-run rejection, payer/beneficiary separation, fail-closed reputation) that the platform's safety claims rest on.

## Pull requests

- Keep PRs focused — one logical change per PR.
- For changes to `programs/`, describe the security implications in the PR body and update `tests/` and the relevant `scripts/prove-*.ts`.
- TypeScript: the repo uses strict mode; `npm run lint` must pass.
- No secrets in commits — `.env` files are gitignored; only `.env.example` templates belong in the tree.

## Security issues

**Do not open public issues for vulnerabilities.** See [SECURITY.md](SECURITY.md).

## Questions

Open a GitHub Discussion or issue — for agent-integration questions (MCP/ACP/x402), include the client you're integrating from and a request/response trace if you have one.
