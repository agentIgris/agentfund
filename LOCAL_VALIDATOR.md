# AgentFund — Local Validator Environment (WSL Ubuntu 22.04)

End-to-end verification environment, since devnet faucet was rate-limited and a
local validator gives unlimited SOL + instant confirmation + clock control.

## Toolchain (WSL Ubuntu 22.04)
- Rust host: stable (SBF build uses Solana's pinned rustc regardless)
- Solana CLI 4.1.1 (Agave), cargo-build-sbf 4.1.0
- Anchor 0.30.1 (avm) — used for build only; IDL gen blocked by known
  anchor-syn/modern-Rust `source_file` incompatibility, so tests run live
  on-chain rather than via the ts-mocha/IDL harness.
- Node 20.20.2 native in WSL
- Repo lives at `~/agentfund` (Linux fs); Windows tree at `E:\AIfundraising\agentfund` kept in sync.
- Env bootstrap: `source ~/af-env.sh` (pins active_release to stable Solana, puts linux node + solana + cargo first on PATH).

## Program IDs (real keypairs in target/deploy/*-keypair.json)
- agent_registry = 2TqDeKaadPUeBcgaXXqYAqddfZngUfbq4m8iDSyePSBA
- escrow         = HiuwNu1K927uTd8xvVCXUHvJW7BcBCgrNBAMC3qUN1Sz
- reputation     = 7DVKSmmhKVWW5JpwWCS89Fi6uwj3RaPADEBbVqyH8Zo7

## Deploy wallet
- DE6LQa1RRKHjwH8QvJ2SoACWejK36Yx6tronj7yD9dcE (~/.config/solana/id.json)

## Start / deploy
```bash
source ~/af-env.sh
solana-test-validator --reset --quiet &      # unlimited SOL, no rate limits
solana config set --url http://127.0.0.1:8899
solana airdrop 100
for p in agent_registry escrow reputation; do
  solana program deploy target/deploy/$p.so --program-id target/deploy/$p-keypair.json
done
```

## Deploy note (SBPF version)
The upgradeable-loader `solana program deploy` was rejected with
"Detected sbpf_version required by the executable which are not enabled" —
the 4.1 toolchain emits an SBPF version the test-validator runtime doesn't
activate by default. Workaround: load all 3 at genesis via
`solana-test-validator --bpf-program <ID> <SO>` (see start command above).
For real devnet/mainnet deploy this won't apply (those clusters enable current
SBPF), but if it does, rebuild with `cargo-build-sbf --arch v0`.

## Verification status
- [x] All 3 programs compile to SBF .so (cargo-build-sbf 4.1.0)
- [x] Deployed + live on local validator — all executable:true, owner
      BPFLoaderUpgradeable, data lengths match .so:
        agent_registry 234344 B, escrow 298096 B, reputation 208408 B
- [ ] Escrow flow verified live (contribute → vote → goal-gated release → refund)
      — requires initialize_escrow API/SDK wiring (review finding #9) first.
