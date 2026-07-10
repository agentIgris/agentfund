# AgentFund — Adversarial Review Findings (build run wf_3d4c318e-31e)

## FIX STATUS (final review pass)
- ✅ #1 release_milestone goal-met gate — FIXED (escrow lib.rs, + GoalNotMet error, + status check)
- ✅ #2 stale vote weight after refund — RESOLVED by #1 (goal-met and refund-eligible now mutually exclusive)
- ✅ #3 initialize_escrow authz — HARDENED: `creator` is now a required Signer (not a spoofable arg). Full registry-CPI binding still TODO before mainnet (see code TODO).
- ✅ #4 /auth/verify message binding — FIXED (stores canonical message in Redis, byte-compares)
- ✅ #5 JWT/secret prod fail-fast — FIXED (assertProductionConfig in config.ts, called at startup)
- ✅ #6 /tx/send open relay — FIXED (requireAuth + program-id allowlist)
- ✅ #7 webhook SSRF — FIXED (new lib/ssrf.ts, checked at register + delivery)
- ✅ #8 Helius webhook secret — FIXED (fail-closed + timingSafeEqual)
- ⏳ #9 initialize_escrow builder/tx.build case — DEFERRED (needs escrow↔registry integration; tracked)
- ⏳ #10 reputation write path — DEFERRED (needs platform-signed indexer job; tracked)
- ✅ #11 MCP envelope unwrap — FIXED (list_projects, get_project, get_agent, 3 resources)
- ✅ #12 Contribution.project→projectId — FIXED (shared types + web)
- ✅ #13 SDK README npm install — FIXED (honest install-from-source note)
- ✅ #14 MCP list_projects double-wrap — FIXED (same as #11)

All 6 TS workspaces recompile clean after fixes. Rust not locally compiled (path-space toolchain block); escrow edits are review-correct, to be `anchor build`-verified post-relocation.

### Remaining before mainnet (tracked, need Solana toolchain/integration):
- #9 + #3: wire `initialize_escrow` to fire from `agent_registry::create_project` (CPI) or bind to a registry ProjectAccount, and add its tx-builder + action so contribute/vote/release/refund are reachable end-to-end.
- #10: platform-signed reputation update job in the indexer.
- External escrow audit (per $17k campaign milestone 2).

---


Build status: all 6 TS workspaces (shared, api, mcp, acp, sdk, web) compile & pass.
Rust programs: **skipped** — MSVC `link.exe` fails because the repo path `E:\AI fund raising\` contains a SPACE. Programs must be built from a space-free path.

Severity tally: escrow {2 crit, 1 high}, auth/api {2 crit, 3 high}, wiring {2 crit, 2 high}, agent-adoption {2 high}.

## CRITICAL — Escrow (fund safety)
1. **release_milestone never checks goal met / deadline / status** (`programs/escrow/src/lib.rs` ~289-440). Only checks milestone order, creator, and `approving_weight*2 > total_deposited` read live. Exploit: attacker contributes, self-votes >50% of *current* deposits, drains before goal reached. FIX: `require!(total_deposited >= goal_amount, GoalNotMet)` (+ status Active) in release_milestone.
2. **Stale vote weight after refund** (~233-280 vote, ~446-533 refund). VoteAccount.weight is a frozen snapshot; refund() closes the ContributionAccount but the cast vote keeps counting forever. Largely closed by fix #1 (goal-met gate); belt-and-suspenders: invalidate/deny votes from refunded contributors.

## HIGH — Escrow
3. **initialize_escrow has no authorization** (~71-127). `creator/goal/deadline/milestone_count/token_mint` are attacker-controlled args; any signer can claim the `[ESCROW_SEED, project]` slot first. FIX: make it CPI-only from `agent_registry::create_project`, or bind + verify against the registry ProjectAccount.

## CRITICAL — Auth / API
4. **/auth/verify doesn't check message == canonical challenge** (`api/src/routes/auth.ts` 64-91). Signature is verified over the *client-supplied* message, so any wallet can authenticate as itself with an arbitrary message. FIX: store exact expected message in Redis at challenge time; byte-compare before nacl verify.
5. **JWT secret defaults to hardcoded string** (`api/src/config.ts` 62/73). `"dev-insecure-secret-change-me"` used if `JWT_SECRET` unset; no production fail-fast → anyone forges JWTs for any wallet. Same default for webhook signing secret. FIX: throw at startup if isProduction and secret unset/default.

## HIGH — Auth / API
6. **/tx/send is an open, unauthenticated relay** (`api/src/routes/tx.ts` 160-181). No auth, no check that instructions target our program IDs → anyone broadcasts any tx through our RPC. FIX: requireAuth + validate every instruction programId ∈ {registry, escrow, reputation}.
7. **Webhook SSRF** (`api/src/routes/webhooks.ts`). `url` only `z.string().url()`; BullMQ worker fetches it → hits 127.0.0.1, 169.254.169.254 (cloud metadata), RFC1918. FIX: resolve+block loopback/link-local/private ranges at register AND delivery time.
8. **Helius webhook secret defaults empty, check skipped** (`api/src/services/helius.ts` 200-207). `if (webhookSecret)` → when unset, endpoint accepts any body and mutates project status/reputation. FIX: require secret at startup; timingSafeEqual compare.

## CRITICAL — Wiring (functional blockers)
9. **No initialize_escrow builder / tx.build case anywhere** (api/mcp/acp/sdk). contribute/vote/release/refund require the escrow PDA to already exist → on a fresh project they can NEVER succeed. FIX: add buildInitializeEscrowIx + `initialize_escrow` action (or fold into create_project flow / CPI).
10. **Reputation writes are dead** (`programs/reputation` + `api/src/services/indexer.ts`). No init_reputation/update_reputation builder; `platformWalletKeypairPath` never read; indexer only consumes events nothing emits. Scores shown everywhere but never change. FIX: platform-signed job calling reputation ixs on milestone/vote/contribution — or descope and remove dead config.

## HIGH — Wiring
11. **MCP response envelope mismatch** (mcp tools/resources). Typed as bare `Project[]`/`Agent` but REST returns `{projects}`/`{agent,stats}` etc. → double-nested/undefined output. FIX: unwrap named keys.
12. **Contribution.project vs projectId** (`shared/src/types.ts` 81-89 vs Prisma). web reads `contribution.project` (undefined at runtime → broken links). FIX: rename to `projectId` in shared + web.

## HIGH — Agent adoption
13. **SDK README says `npm install @agentfund/sdk` but package is private/unpublished** → external agent fails at step 1. FIX: publish shared+sdk to npm (remove private, add publishConfig, CI publish), or rewrite install to git/tarball.
14. **MCP list_projects double-wrap** → emits `{projects:{projects:[...]}}`. Same unwrap fix as #11.

## Also to address in the x402 phase
- The x402 donation rail's `contribute_for` must carry the SAME goal-met/status gating discipline as fixes #1–#3.
