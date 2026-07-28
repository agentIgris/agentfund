# Security Policy

AgentFund's escrow program holds pooled user/agent funds. We take that seriously and want you to be able to verify our claims rather than trust them.

## Current status

| | |
|---|---|
| **Cluster** | Solana **devnet** only — no real funds are at risk today |
| **External audit** | **Not yet performed.** An independent audit of `programs/escrow` is a funded milestone of the platform's own raise and a hard gate before uncapped mainnet volume |
| **Internal review** | 14 findings from an adversarial self-review tracked in [REVIEW_FINDINGS.md](REVIEW_FINDINGS.md); all program- and API-level findings fixed and covered by proofs |
| **Live proofs** | `scripts/prove-escrow-flow.ts` (22 checks) and `scripts/prove-x402-live.ts` (9 checks) replay the security properties against a live deployment |

## Threat model (what the programs enforce)

- **Escrow custody**: contributions are held by a program-derived account; no platform key can move them. Releases require the funding goal met **and** a contribution-weighted milestone vote. Failed campaigns refund contributors 1:1.
- **Front-running**: `initialize_escrow` cross-verifies the registry project account (creator signer, goal, deadline, milestone count, mint). An attacker cannot pre-create a hostile escrow for someone else's project or with altered terms.
- **x402 settlement**: the API verifies submitted payment transactions structurally before relaying — program allowlist, exactly one contribute/contribute_for instruction, decoded project + amount must match the challenge, destination must be the canonical escrow PDA.
- **Payer/beneficiary separation**: `contribute_for` credits vote weight and refund rights to the beneficiary, never the payer, so a facilitator settling payments gains no governance power.
- **Settlement authorization (optional, off by default)**: an operator may require an external provider to authorize the exact signed transaction before broadcast, via the `SettlementAuthorizationProvider` interface. The gate runs *after* the structural checks above and *before* broadcast, and fails closed. It is disabled unless explicitly enabled, and provider credentials never leave the server — donors supply only public identifiers, and the evidence returned to clients is whitelist-constructed rather than passed through. A confirmed on-chain payment is never reported as failed if provider evidence or event publication fails afterwards. See [Optional settlement authorization](#optional-settlement-authorization) below.
- **Reputation integrity**: the reputation program stores the reason→delta point table on-chain and rejects any update whose delta doesn't match its stated reason, even from the platform authority.

## Known limitations

- The escrow program is **unaudited custom code**. Mainnet launch will start with hard per-project deposit caps until the external audit completes.
- The reputation writer and indexer are platform-operated off-chain services; their liveness (not their integrity — see above) depends on us.

## Optional settlement authorization

The API supports an optional, vendor-neutral `SettlementAuthorizationProvider` hook that can require an
external service to authorize the exact signed transaction before it is broadcast. **It is disabled in
production and ships disabled by default** (`SVS_X402_ENFORCE` unset or `false`); with it off, the x402
flow is unchanged and the provider is a no-op.

The first available provider is [SVS Protocol](https://svsprotocol.com). Its SDK dependency is pinned to
an **exact** version (no semver range) because it sits on the settlement path.

Enabling enforcement in production requires **all** of the following, in order:

1. A completed joint devnet proof: deliberate exact-transaction mismatch rejection, a matching x402
   contribution authorization + broadcast, and `contribution.verified` evidence.
2. A fresh audit of the **then-current** provider SDK version — install hooks, transitive dependencies,
   exported behavior, and outbound network destinations.
3. A dedicated relayer credential scoped to only the intended donor-agent bot IDs. Credentials are
   server-side only and must never be committed.

Deployment specifics are in [deploy/README.md](deploy/README.md#optional-svs-x402-action-gate).

## Reporting a vulnerability

Please **do not open a public issue** for security-sensitive reports.

- Open a [GitHub Security Advisory](../../security/advisories/new) (preferred), or
- DM the maintainer via the contact listed on [agentfund.online](https://agentfund.online).

We'll acknowledge within 72 hours. Once funds are live on mainnet, a paid bug-bounty program is planned (see milestone 2 of the platform raise); until then, meaningful findings will be credited in the repo and prioritized for retroactive rewards.

## Scope

In scope: everything under `programs/`, `api/src/routes/x402.ts`, `api/src/services/{solana,reputationIx,reputationWriter,indexer}.ts`, and the SDK payment flow.
Out of scope: devnet-only denial of service, rate-limit exhaustion of public faucets, social engineering.
