//! `reputation` — Phase-1 scoped per implementation_plan.md ("Program 3:
//! reputation"): agent reputation lives purely as an on-chain
//! `ReputationAccount` PDA (score/events/timestamp), read directly by any
//! agent or by the API's `GET /agents/:pubkey` handler.
//!
//! ## Phase-2 integration point: Metaplex Bubblegum soulbound cNFT mirror
//!
//! Phase 2 adds a soulbound Metaplex Bubblegum compressed NFT that
//! *mirrors* this PDA so reputation is also visible as a wallet-held
//! token (per the spec's "Agent Reputation System" section: mint on
//! first action, non-transferable, tied to the wallet forever). The
//! intended integration points, once added:
//!
//!   - `init_reputation` gains a CPI to Bubblegum's `mint_to_collection_v1`
//!     (or a plain `mint_v1` if ungrouped), minting a single soulbound
//!     leaf for `agent` into a platform-owned merkle tree the first time
//!     an agent's score account is created. The leaf's metadata URI would
//!     point at off-chain JSON mirroring `score`/`events_count`.
//!   - `update_reputation` gains a CPI to Bubblegum's `update_metadata`
//!     (or a burn + re-mint, depending on the Bubblegum version deployed)
//!     so the cNFT's displayed score stays in sync with this PDA after
//!     every authority-driven delta.
//!   - A new `platform_tree` / `tree_authority` / `merkle_tree` set of
//!     accounts (owned by Bubblegum + SPL Account Compression + the
//!     Noop program) would be added to `InitReputation` and
//!     `UpdateReputation`'s account contexts.
//!   - `get_reputation` needs no new instruction — it is already
//!     satisfied by any client fetching the `ReputationAccount` PDA
//!     directly (see the `reputation` field on `program.account` in the
//!     TS SDK), and will remain the canonical source of truth even
//!     after the cNFT mirror is added.
//!
//! None of the above requires a breaking change to this program's
//! existing accounts or instructions — the cNFT is additive.

use anchor_lang::prelude::*;

// Placeholder program id — replaced with the value of REPUTATION_PROGRAM_ID
// (env) once deployed. Keep in sync with Anchor.toml.
declare_id!("Reput1111111111111111111111111111111111111");

// ─────────────────────────────────────────────────────────────
// PDA seeds — must match shared/src/constants.ts PDA_SEEDS byte-for-byte.
// (CONFIG_SEED, like agent_registry's, is program-local and intentionally
// not duplicated into the shared TS constants — only cross-program seeds
// live there.)
// ─────────────────────────────────────────────────────────────

pub const CONFIG_SEED: &[u8] = b"config";
pub const REPUTATION_SEED: &[u8] = b"reputation";

/// Starting score for every newly-initialized ReputationAccount.
pub const INITIAL_SCORE: u64 = 100;

#[program]
pub mod reputation {
    use super::*;

    /// Initializes the platform-wide Config PDA, storing the authority
    /// pubkey (the platform indexer wallet) that alone may call
    /// `update_reputation`. Callable once — the `init` constraint on
    /// `config` rejects a second invocation.
    pub fn initialize(ctx: Context<Initialize>, authority: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = authority;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Permissionlessly initializes an agent's ReputationAccount PDA
    /// (seeds = ["reputation", agent_wallet]) with the starting score.
    /// Anyone may call this on behalf of any agent wallet — it only
    /// creates a zeroed-out score account, so there is nothing to gate.
    pub fn init_reputation(ctx: Context<InitReputation>) -> Result<()> {
        let reputation = &mut ctx.accounts.reputation;
        let now = Clock::get()?.unix_timestamp;

        reputation.agent = ctx.accounts.agent.key();
        reputation.score = INITIAL_SCORE;
        reputation.events_count = 0;
        reputation.last_updated = now;
        reputation.bump = ctx.bumps.reputation;

        emit!(ReputationInitialized {
            agent: reputation.agent,
            score: reputation.score,
            timestamp: now,
        });

        Ok(())
    }

    /// Applies a reputation delta to an agent's score. Restricted to the
    /// platform authority stored in the Config PDA. `reason` selects one
    /// of the spec's point-table entries; `delta` must equal that
    /// entry's value (enforced on-chain, not merely trusted off-chain),
    /// so a compromised or buggy indexer cannot apply an arbitrary
    /// delta even though it already must hold the authority key.
    /// Score saturates at 0 and never underflows.
    pub fn update_reputation(ctx: Context<UpdateReputation>, delta: i64, reason: u8) -> Result<()> {
        let expected_delta = ReputationReason::from_u8(reason)?.point_value();
        require!(delta == expected_delta, ReputationError::DeltaReasonMismatch);

        let reputation = &mut ctx.accounts.reputation;
        let old_score = reputation.score;

        // i128 avoids any overflow while combining a u64 score with an
        // i64 delta; the result is then clamped into u64 range so the
        // score saturates at 0 instead of underflowing.
        let combined = (old_score as i128) + (delta as i128);
        let new_score = combined.clamp(0, u64::MAX as i128) as u64;

        reputation.score = new_score;
        reputation.events_count = reputation
            .events_count
            .checked_add(1)
            .ok_or(ReputationError::Overflow)?;
        let now = Clock::get()?.unix_timestamp;
        reputation.last_updated = now;

        emit!(ReputationUpdated {
            agent: reputation.agent,
            old_score,
            new_score,
            delta,
            reason,
            events_count: reputation.events_count,
            timestamp: now,
        });

        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────
// Accounts contexts
// ─────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitReputation<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: the agent wallet this score account belongs to. It only
    /// needs to supply its address to derive the PDA seed — it does not
    /// need to sign, since init_reputation is intentionally
    /// permissionless (anyone may bootstrap any agent's score account).
    pub agent: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + ReputationAccount::INIT_SPACE,
        seeds = [REPUTATION_SEED, agent.key().as_ref()],
        bump
    )]
    pub reputation: Account<'info, ReputationAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateReputation<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ ReputationError::Unauthorized,
    )]
    pub config: Account<'info, Config>,

    /// CHECK: the agent wallet whose score is being updated. Only used
    /// to derive the ReputationAccount PDA seed.
    pub agent: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [REPUTATION_SEED, agent.key().as_ref()],
        bump = reputation.bump,
    )]
    pub reputation: Account<'info, ReputationAccount>,
}

// ─────────────────────────────────────────────────────────────
// Account state
// ─────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct Config {
    /// Platform authority pubkey (the platform indexer wallet) — the
    /// only signer permitted to call `update_reputation`.
    pub authority: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ReputationAccount {
    /// Agent's wallet — also the PDA seed + identity.
    pub agent: Pubkey,
    /// Saturates at 0 on the downside; starts at INITIAL_SCORE.
    pub score: u64,
    /// Number of `update_reputation` calls applied to this account.
    pub events_count: u32,
    /// Unix seconds of the last score change (or initialization).
    pub last_updated: i64,
    pub bump: u8,
}

// ─────────────────────────────────────────────────────────────
// Point table (implementation_plan.md § "Agent Reputation System")
// ─────────────────────────────────────────────────────────────

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ReputationReason {
    /// +15 — project milestone released
    MilestoneReleased = 0,
    /// +5 — contribution made to another agent's project
    ContributionMade = 1,
    /// +2 — governance vote cast
    VoteCast = 2,
    /// +50 — project goal fully reached
    GoalReached = 3,
    /// -20 — project refunded (failed)
    ProjectRefunded = 4,
    /// -50 — project flagged as fraudulent
    ProjectFlaggedFraudulent = 5,
}

impl ReputationReason {
    fn from_u8(value: u8) -> Result<Self> {
        match value {
            0 => Ok(Self::MilestoneReleased),
            1 => Ok(Self::ContributionMade),
            2 => Ok(Self::VoteCast),
            3 => Ok(Self::GoalReached),
            4 => Ok(Self::ProjectRefunded),
            5 => Ok(Self::ProjectFlaggedFraudulent),
            _ => Err(ReputationError::InvalidReason.into()),
        }
    }

    fn point_value(self) -> i64 {
        match self {
            Self::MilestoneReleased => 15,
            Self::ContributionMade => 5,
            Self::VoteCast => 2,
            Self::GoalReached => 50,
            Self::ProjectRefunded => -20,
            Self::ProjectFlaggedFraudulent => -50,
        }
    }
}

// ─────────────────────────────────────────────────────────────
// Events — consumed by the off-chain Helius indexer.
// ─────────────────────────────────────────────────────────────

#[event]
pub struct ReputationInitialized {
    pub agent: Pubkey,
    pub score: u64,
    pub timestamp: i64,
}

#[event]
pub struct ReputationUpdated {
    pub agent: Pubkey,
    pub old_score: u64,
    pub new_score: u64,
    pub delta: i64,
    pub reason: u8,
    pub events_count: u32,
    pub timestamp: i64,
}

// ─────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────

#[error_code]
pub enum ReputationError {
    #[msg("Only the platform authority may perform this action.")]
    Unauthorized,
    #[msg("Unrecognized reputation reason code.")]
    InvalidReason,
    #[msg("The supplied delta does not match the point-table value for this reason code.")]
    DeltaReasonMismatch,
    #[msg("Arithmetic overflow occurred while updating account state.")]
    Overflow,
}
