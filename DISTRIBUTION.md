# AgentFund — Distribution & Listing Playbook

*Compiled 2026-07-11 from three research sweeps: MCP/agent registries, x402/Solana ecosystem, launch venues & communities. Status column tracks execution.*

The platform's discovery thesis: **agents find services machine-to-machine** (MCP registries, x402 Bazaar, on-chain agent registries), while **humans find the story** (launch venues, communities, grants). Both funnels matter; the machine funnel is the moat.

---

## Phase 0 — Prerequisites (blockers for everything below)

| # | Prereq | Blocks | Status |
|---|--------|--------|--------|
| P1 | Publish monorepo to a public GitHub repo | ALL registries (crawlers index GitHub), awesome-lists, Show HN, grants | ☐ |
| P2 | Publish `@agentfund/sdk` + `@agentfund/mcp` to npm | Official MCP Registry, Smithery, crawler directories | ☐ |
| P3 | MCP server README with `mcp-name:` tag + `server.json` (`mcp-publisher init`) | Official MCP Registry → cascades to Glama/PulseMCP | ☐ |
| P4 | Devnet deployment live + public API endpoint (api.predictbgmi.fun) | Every listing that asks for a live demo/endpoint | ☐ (programs built; awaiting devnet SOL) |
| P5 | 400×400 PNG logo + demo video/GIF | Cline marketplace, Product Hunt, PH-style venues | ☐ |
| P6 | Landing page on predictbgmi.fun that explains the platform in 30s | All human-facing venues | ☐ |

---

## Phase 1 — Machine discovery (agents find us): highest strategic value

| Priority | Platform | Mechanism | Effort | Notes |
|---|---|---|---|---|
| 1 | **Official MCP Registry** (registry.modelcontextprotocol.io) | `mcp-publisher init` → publish CLI, GitHub-auth namespace | LOW | Root registry — Glama (37k servers), PulseMCP auto-crawl from here. Do FIRST after npm publish. |
| 2 | **Smithery** (smithery.ai) | `smithery mcp publish <url>` CLI, self-serve | LOW | ~6k servers, "central hub" reputation. |
| 3 | **mcp.so** | Self-serve form at mcp.so/submit | LOW | |
| 4 | **x402 Bazaar** (Coinbase CDP) | No form: add `declareDiscoveryExtension()` via `@coinbase/x402` SDK + process ≥1 real settled payment through the CDP facilitator | MED | THE canonical x402 discovery layer (480k+ agents transacting). Likely needs mainnet settlement — verify devnet support with a small test payment first. |
| 5 | **PipRail** (piprail.com/discovery) | One POST request, domain verification, instant | LOW | Fastest x402 listing; appears to accept endpoints pre-settlement → **best devnet-stage x402 listing**. Re-ingests Bazaar data. |
| 6 | **x402scan** (x402scan.com) | Auto-observes payment metadata (like Bazaar) | MED | Solana-specific x402 coverage. Same mainnet-settlement caveat. |
| 7 | **Solana Agent Registry** (solana.com/agent-registry) | On-chain registration (PDA) declaring MCP endpoint + wallet + capabilities | MED-HIGH | On-chain verifiable agent identity, interop with ERC-8004. Very on-thesis; small SOL fee. |
| 8 | **Glama / PulseMCP** | Crawler-based — claim the auto-generated listing after P1-P3 | LOW | No submission; claiming unlocks "Official" trust tier. |
| 9 | **MCP Market** (mcpmarket.com/submit) | Form + editorial review | LOW-MED | |
| 10 | **Cline MCP Marketplace** | GitHub issue + 400×400 logo, reviewed for maturity | MED | "Millions of developers" via VS Code agent. |
| 11 | **awesome-mcp-servers** (punkpeye) | PR to README | MED | 90.5k stars — highest-reach MCP list on GitHub. |
| 12 | **awesome-x402** (Merit-Systems) + **coinbase/x402 showcase** | PRs | LOW | Official Coinbase repo showcase = high-authority backlink. |
| 13 | **ToolSDK.ai registry** | PR with JSON config | MED | Reaches LangChain/CrewAI/AutoGen users. |
| 14 | **Claude Desktop Extensions** | Anthropic interest form, `.mcpb` packaging | HIGH | Gated; long-term play. |

## Phase 2 — Solana/crypto ecosystem listings

| Priority | Platform | Mechanism | Effort | Devnet OK? |
|---|---|---|---|---|
| 1 | **Solana Ecosystem Directory** (solana.com/ecosystem/submit-project) | Web form (Twitter login), ~3 business days review | LOW | Likely (no explicit block) |
| 2 | **DappRadar** | Account → "Submit new dapp"; supports "upcoming" status | LOW-MED | **YES — explicit "unreleased" flow** |
| 3 | **Superteam Earn** (earn.superteam.fun) | Talent profile + grants section; has agent API (AGENT_ALLOWED listings!) | LOW-MED | Yes — early-stage grants |
| 4 | **Colosseum hackathons** (colosseum.com) | Register + build in window; "Eternal Sprint" always open; **Feb 2026 ran an AI-agent hackathon — watch for the next one** | MED | Yes — hackathons are devnet-native |
| 5 | **Dialect Blinks registry** (dial.to/register) | Build actions.json donate-Blink + apply for verification | MED | Worth building: a "donate to campaign" Blink is shareable everywhere |
| 6 | **SendAI Solana Agent Kit** — Show & Tell discussions | GitHub discussion post | LOW | Yes |
| 7 | **Alchemy Dapp Store** | Intake form | LOW | Secondary (EVM-leaning) |
| 8 | Solana dApp Store (mobile) | Publisher portal, NFT-based | HIGH | **NO — mainnet required.** Post-mainnet only. |

## Phase 3 — Human launch venues & communities

| Priority | Channel | Playbook | Effort |
|---|---|---|---|
| 1 | **X/Twitter** | Build-in-public thread cadence; tag @solana, @coinbase, @AnthropicAI, @heyvirtuals, @Superteam, @colosseum; hashtags #Solana #x402 #AIAgents #MCP #BuildInPublic | LOW, ongoing |
| 2 | **r/solana** (458k) | "Self-Promotion" flair, open-source framing: "I open-sourced an AI-agent fundraising platform for Solana" | LOW |
| 3 | **r/AI_Agents** | Showcase post with live devnet demo of autonomous donation flow | LOW |
| 4 | **Solana Tech Discord** (~149k) | Share in showcase/build channels, ask for Anchor feedback | LOW |
| 5 | **Show HN** | "Show HN: AgentFund — AI agents that raise and donate funds via x402 escrow on Solana." Engineering framing ONLY, no token talk, answer every comment | MED |
| 6 | **DEV.to / Hashnode** | Technical tutorials: "Add x402 donations to your agent in 10 lines", architecture deep-dive | LOW |
| 7 | **Peerlist Launchpad** | Weekly Monday launches, no cooldown — good for iterative launches | LOW |
| 8 | **Product Hunt** | Full launch-day production: visuals, demo video, all-day engagement. Save for mainnet launch | MED |
| 9 | **AlternativeTo** | Evergreen listing, long-tail SEO ("crypto donation platform") | LOW |
| 10 | r/SolanaDev | Check live sidebar rules first (unindexed) | LOW |

## Phase 4 — Funding & revenue channels

| Priority | Channel | Mechanism | Fit |
|---|---|---|---|
| 1 | **Superteam Earn microgrants** (~$10k, regional incl. India) | Apply via Earn; devnet-stage explicitly welcomed | **Strong — apply as soon as devnet demo is live** |
| 2 | **Solana Foundation grants** (solana.org/grants-funding) | Rolling application; open-source public-good angle (SDK/MCP/escrow) | Good but slower/competitive |
| 3 | **Devpost / Colosseum AI-agent hackathons** | $100k+ prize pools; Feb 2026 had an agents-build-crypto hackathon — perfect thesis match | Strong — enter the next one |
| 4 | **GitHub Sponsors + Open Collective** | Org account + OSC fiscal host; fiat-only (10% fee) | Moderate — trust layer for OSS contributors; pair with wallet-based crypto donations page |
| 5 | Virtuals Protocol (ACP) | Tokenize as bonding-curve agent (~100 $VIRTUAL) | Weak fit for escrow model — skip unless strategy changes |
| 6 | Olas Mech Marketplace | Self-serve listing | Low real traction (~$89k lifetime) — low priority |

---

## Execution order (devnet-first reality)

**Week 1 (devnet live):** P1-P6 prereqs → Official MCP Registry → Smithery → mcp.so → PipRail → Solana Ecosystem Directory → DappRadar (upcoming) → r/solana + r/AI_Agents + Discord posts → Superteam grant application.

**Week 2:** awesome-lists PRs (mcp-servers, x402, coinbase showcase) → Glama/PulseMCP claims → DEV.to tutorial → Show HN → Peerlist → X cadence running.

**Mainnet launch day:** x402 Bazaar settlement (auto-index) → x402scan → Solana Agent Registry on-chain → Product Hunt → Solana dApp Store → second Show HN/X push with "first campaign is the platform funding itself."

**Open questions to verify when executing:**
- x402 Bazaar/x402scan devnet indexing (test one small payment against CDP facilitator).
- coinbase/x402 showcase exact submission path (check repo README).
- r/SolanaDev posting rules (check sidebar live).
- Superteam grant devnet eligibility (strongly implied, not written).
