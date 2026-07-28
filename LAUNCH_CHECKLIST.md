# AgentFund Launch Checklist

Compiled by the integration agent from all seven build agents' reports. Everything below is a real remaining action — nothing here is done automatically by this repo.

---

## (a) DO NOW — security & infrastructure

1. **Revoke the two npm tokens that were pasted in chat.** Go to https://www.npmjs.com/settings/~/tokens (or your org's tokens page) → find any token you pasted into this conversation → **Revoke**. Do this immediately regardless of anything else below — those tokens must be treated as compromised.

2. **DNS for agentfund.online → Vercel.** ✅ Resolved — the landing page is live at https://agentfund.online, served by the Vercel project `agentfund-site` (root `docs/`). Nameservers for `agentfund.online` point at Vercel DNS (`ns1`/`ns2.vercel-dns.com`), which manages the apex, `www`, and `app.agentfund.online` (dashboard, project `agentfund-dashboard`) records. Verify with `vercel domains inspect agentfund.online` or `dig agentfund.online +noall +answer`.

3. **Republish `@agentfund/mcp` to npm as 0.1.1** (unblocks the MCP Registry submission — flagged `partial` by the mcpRegistry agent). Files are already prepared at version 0.1.1 with the `mcpName` ownership marker (`mcp/package.json`, `mcp/server.json`, `mcp/README.md`).
   - Create a new granular npm access token scoped to `@agentfund/mcp` (Read+Write) at https://www.npmjs.com/settings/<org-or-user>/tokens/. Do **not** paste it into any file.
   - From a shell with the token only in your environment (not on disk in the repo):
     ```
     cd E:\AIfundraising\agentfund\mcp
     npm run build
     npm publish --access public --//registry.npmjs.org/:_authToken=<YOUR_NEW_NPM_TOKEN>
     ```
   - Verify: `curl https://registry.npmjs.org/@agentfund/mcp/0.1.1` should show `"mcpName":"io.github.agentIgris/agentfund"`.
   - Then finish the MCP Registry publish (CLI already installed and authenticated as agentIgris at `E:\AIfundraising\tmp-mcppub\mcp-publisher.exe`; if its cached token expired, re-login first):
     ```
     GH_TOKEN=$(gh auth token)
     E:\AIfundraising\tmp-mcppub\mcp-publisher.exe login github --token "$GH_TOKEN"
     cd E:\AIfundraising\agentfund\mcp
     E:\AIfundraising\tmp-mcppub\mcp-publisher.exe publish
     ```
   - Confirm listing: `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.agentIgris/agentfund"`

4. **Devnet x402 smoke test is blocked** — no devnet USDC in the deploy wallet `DE6LQa1RRKHjwH8QvJ2SoACWejK36Yx6tronj7yD9dcE` (0 token accounts), and Circle's devnet faucet is browser-only (reCAPTCHA, no scriptable API). To unblock:
   - Open https://faucet.circle.com, select asset USDC, network "Solana Devnet", paste `DE6LQa1RRKHjwH8QvJ2SoACWejK36Yx6tronj7yD9dcE`, solve the reCAPTCHA, submit (limit 20 USDC / address / 2h).
   - Confirm receipt (WSL): `export PATH=$PATH:~/.local/share/solana/install/active_release/bin && spl-token balance 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU --owner DE6LQa1RRKHjwH8QvJ2SoACWejK36Yx6tronj7yD9dcE --url https://api.devnet.solana.com`
   - Start Postgres + Redis, run `prisma db push` against a devnet-pointed `DATABASE_URL`, then start the API (in `~/agentfund/api`) with env: `SOLANA_CLUSTER=devnet`, `SOLANA_RPC_URL=https://api.devnet.solana.com`, `REGISTRY_PROGRAM_ID=2TqDeKaadPUeBcgaXXqYAqddfZngUfbq4m8iDSyePSBA`, `ESCROW_PROGRAM_ID=HiuwNu1K927uTd8xvVCXUHvJW7BcBCgrNBAMC3qUN1Sz`, `REPUTATION_PROGRAM_ID=7DVKSmmhKVWW5JpwWCS89Fi6uwj3RaPADEBbVqyH8Zo7`, `PLATFORM_WALLET_KEYPAIR_PATH=~/.config/solana/id.json`.
   - Reuse `scripts/prove-x402-live.ts` targeting the existing project PDA `9RRsXtiCFu2RmGBcqcjosxek1QLjWVW8Z74hvJ6Bjh8H` / escrow PDA `AsfYmmyw6uMhshEJtAXPRT3G5qgFCfB3c54n42ErZcCy`, amount `1000000` (1 USDC).
   - Verify on-chain: `spl-token balance HUogrZJGWoPg4DFjtDfo2HpFLfv8Hxd5wFjNsFjBu83P --url https://api.devnet.solana.com` before/after, and check the tx at `https://solscan.io/tx/<sig>?cluster=devnet`.
   - Update the "Devnet x402 smoke test" section in `DEPLOYMENT.md` with the resulting signature/link/amount, and stop any servers started for the test.

5. **Cleanup (optional, safe to delete, all outside the repo):**
   - `E:\AIfundraising\tmp-logo` (SVG→PNG render scratch dir)
   - `E:\AIfundraising\tmp-mcppub` (mcp-publisher.exe — keep until step 3 above is done)
   - `E:\AIfundraising\tmp-awesome` (forked repos used for the three awesome-list PRs)
   - `E:\AIfundraising\.claude\launch.json` (local preview server config, not part of the site)

---

## (b) SUBMIT — directory, grant & social listings

Draft files live in `E:\AIfundraising\launch-drafts\`. None of these have been submitted; all require a human due to CAPTCHA/OAuth/account gating.

### Directory listings (`launch-drafts\listings\`)
- **PipRail / 402 Index** (`piprail.md`) — blocked until `api.agentfund.online` is live and returns real HTTP 402s (the registration endpoint probes the URL synchronously). Once deployed: run the claim → serve verification file at `/.well-known/402index-verify.txt` → verify → register curl sequence documented in the file.
- **Smithery** (`smithery.md`) — run `npm install -g smithery && smithery auth login && smithery namespace create agentfund`, build an `.mcpb` bundle from `mcp/`, then `smithery mcp publish ./agentfund.mcpb -n agentfund/agentfund-mcp`.
- **mcp.so** (`mcp-so.md`) — go to https://mcp.so/submit, paste `https://github.com/agentIgris/agentfund` into the single "GitHub repository URL" field, submit.
- **Solana Ecosystem Directory** (`solana-directory.md`) — log into https://solana.com/ecosystem with Twitter/X, click "Submit Project", paste Project/Tagline/Website/Description from the file.
- **DappRadar** (`dappradar.md`) — create + verify a DappRadar account, dashboard → "Submit New Dapp" → "not yet released" pathway, fill fields from the file, upload a 250×250 resized copy of `assets/brand/logo-400.png`.
- **MCP Market** (`mcpmarket.md`) — open https://mcpmarket.com/submit in a real browser (bot-check blocked automated fetches; should clear for a human) and paste the fields from the file (best-effort inferred, verify live).

### Grants (`launch-drafts\grants\`)
- **Superteam Earn** (`superteam-microgrant.md`) — open https://superteam.fun/earn/grants, filter Region = India (or Global) and Status = Open, pick the live ~$10k-tier listing (candidates tabulated at top of the file), paste in the answers.
- **Solana Foundation** (`solana-foundation.md`) — open https://solana.org/grants-funding, transcribe answers from the file (uses $10,000 ask + M1-M3 milestones). Disclose the parallel Superteam application if the form asks about other grant applications for the same project.
- Add a real contact email to both files before submitting if the form requires one beyond the GitHub profile (agentIgris) — none is currently published.

### Social / content (`launch-drafts\content\`)
- **x-thread.md** — 12-tweet thread, character counts verified (216-267 chars each). Post to X/Twitter.
- **reddit-r-solana.md** — post to r/solana.
- **reddit-r-ai-agents.md** — post to r/AI_Agents (or similar), MCP config + raw x402 HTTP flow angle.
- **show-hn.md** — engineering-only framing for Show HN; the 6 prepared Q&A answers are meant to be posted as replies when those questions actually come up, not pre-posted as one block.
- **devto-tutorial.md** — before publishing, confirm the cover image `https://raw.githubusercontent.com/agentIgris/agentfund/main/assets/brand/og-image.png` resolves publicly (requires assets/brand/og-image.png to be pushed to main first — this integration pass does that, see section below).
- `reddit-r-ai-agents.md` and `show-hn.md` reference `REVIEW_FINDINGS.md` and `scripts/prove-*.ts` by GitHub blob URL — confirm those files are committed/pushed to `main` before posting (this integration pass pushes the assets covered in this task; verify the rest are already on `main` from earlier work).

---

## (c) WATCH — outreach PRs (status as of 2026-07-27)

**Merged ✅**

- https://github.com/punkpeye/awesome-mcp-servers/pull/9850 — "Add @agentfund/mcp to Finance & Fintech" — **MERGED 2026-07-21**

**Open, mergeable and clean — waiting on maintainer action only**

- https://github.com/StockpileLabs/awesome-solana-oss/pull/63
- https://github.com/sendaifun/awesome-solana-mcp-servers/pull/45

**Open, blocked by each repo's required-review gate (not by our entry)**

- https://github.com/solana-foundation/awesome-solana-ai/pull/196 — greptile bot feedback addressed
- https://github.com/helius-labs/solana-awesome/pull/55
- https://github.com/Merit-Systems/awesome-agentic-commerce/pull/439 — "Add AgentFund to Ecosystem" (repo formerly named awesome-x402)

**Open, mergeability not yet recomputed by GitHub; no maintainer feedback**

- https://github.com/xpaysh/awesome-x402/pull/809
- https://github.com/x402-foundation/x402/pull/2835 — "Add AgentFund to ecosystem page" (filed against canonical upstream since coinbase/x402 is a read-only dev-fork mirror with issues disabled; ~5 business day review SLA stated by the repo). Once AgentFund is redeployed to mainnet, consider a follow-up PR recategorizing the ecosystem entry from "Infrastructure & Tooling" to "Services/Endpoints".

No action is owed by us on any open item above.

---

## (d) Inbound integrations

- **SVS Protocol settlement gate — PR #2 MERGED 2026-07-27** (`bb79c88`, squashed). Optional
  `SettlementAuthorizationProvider` with SVS as the first provider; `SVS_X402_ENFORCE=false` in
  production. Security-reviewed before merge; SDK pinned to an exact version. SVS shipped their
  reciprocal side (`@svsprotocol/solana@0.6.0` with an `agentfund` adapter export, a registry
  backlink, and machine-readable pilot status, all scoped as "integration pilot, not a verified
  agent"). **Next:** joint devnet proof sequence, then co-published case study. Enforcement stays off
  until both land plus a re-audit of the then-current SDK — see
  [SECURITY.md](SECURITY.md#optional-settlement-authorization).
  Tracking issue: https://github.com/agentIgris/AgentFund/issues/1

---

## Reference: on-chain / package identifiers

- GitHub: https://github.com/agentIgris/agentfund (public)
- npm (live @ 0.1.0): `@agentfund/shared`, `@agentfund/sdk`, `@agentfund/mcp`
- MCP registry name (pending 0.1.1 republish): `io.github.agentIgris/agentfund`
- Devnet programs: agent_registry `2TqDeKaadPUeBcgaXXqYAqddfZngUfbq4m8iDSyePSBA`, escrow `HiuwNu1K927uTd8xvVCXUHvJW7BcBCgrNBAMC3qUN1Sz`, reputation `7DVKSmmhKVWW5JpwWCS89Fi6uwj3RaPADEBbVqyH8Zo7`
- Demo project PDA `9RRsXtiCFu2RmGBcqcjosxek1QLjWVW8Z74hvJ6Bjh8H`, escrow PDA `AsfYmmyw6uMhshEJtAXPRT3G5qgFCfB3c54n42ErZcCy`
- Development donation address: `DE6LQa1RRKHjwH8QvJ2SoACWejK36Yx6tronj7yD9dcE`
- Domain: agentfund.online (landing page at `docs/index.html`, deployed via Vercel project `agentfund-site`)
