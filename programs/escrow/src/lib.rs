//! AgentFund — Escrow program (Program 2 per implementation_plan.md).
//!
//! Custodies real contributor funds (SOL or SPL/USDC) for a fundraising
//! project, gates milestone releases behind on-chain contributor voting,
//! and returns funds to contributors when a campaign fails. Every
//! instruction assumes an adversarial caller: all PDA relationships are
//! re-derived and checked via `seeds`/explicit constraints, and every
//! rejection path has a dedicated custom error.
//!
//! Design note — self-contained by design: `agent_registry` (Program 1)
//! is a separate Anchor program built independently. Rather than taking a
//! compile-time crate dependency on its (still-evolving) account layout,
//! this program treats `project` as an opaque `Pubkey` identifier passed
//! as an instruction argument (the same value used as the seed for
//! `ProjectAccount` on the registry side) and keeps its own minimal,
//! immutable snapshot of the fields it needs to enforce escrow semantics
//! (`goal_amount`, `deadline`, `milestone_count`, `creator`), captured at
//! `initialize_escrow` time. This keeps the two programs independently
//! buildable/testable while the seeds still tie every PDA
//! (`EscrowAccount` / `ContributionAccount` / `VoteAccount`) to the same
//! project identifier. Wiring `initialize_escrow` up to fire via CPI from
//! `agent_registry::create_project` (or from the API layer immediately
//! after) is the integration agent's job — see TODOs below.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer as SystemTransfer};
use anchor_spl::associated_token::{self, AssociatedToken};
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer as TokenTransfer};
use std::str::FromStr;

use agent_registry::ProjectAccount;

// Placeholder program id — replaced with the value of ESCROW_PROGRAM_ID
// (env) once deployed. Keep in sync with Anchor.toml.
declare_id!("HiuwNu1K927uTd8xvVCXUHvJW7BcBCgrNBAMC3qUN1Sz");

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

/// PDA seed prefixes. Must byte-for-byte match `PDA_SEEDS` in
/// shared/src/constants.ts.
pub const ESCROW_SEED: &[u8] = b"escrow";
pub const CONTRIBUTION_SEED: &[u8] = b"contribution";
pub const VOTE_SEED: &[u8] = b"vote";

/// Sentinel mint used to represent native SOL (no SPL token account —
/// the escrow PDA itself holds lamports directly). Must match
/// `NATIVE_SOL_MINT` in shared/src/constants.ts.
const NATIVE_SOL_MINT_STR: &str = "So11111111111111111111111111111111111111112";

/// Resolved at runtime (not `const`) to avoid depending on the `pubkey!`
/// macro's import path across anchor-lang versions; this is cheap and
/// only called a handful of times per instruction.
fn native_sol_mint() -> Pubkey {
    Pubkey::from_str(NATIVE_SOL_MINT_STR).expect("hardcoded native SOL mint is valid base58")
}

// ─────────────────────────────────────────────────────────────
// Program
// ─────────────────────────────────────────────────────────────

#[program]
pub mod escrow {
    use super::*;

    /// Bootstraps the `EscrowAccount` PDA for a project (and, for SPL
    /// campaigns, its associated token account). Not one of the four
    /// instructions named in the spec's contribution/vote/release/refund
    /// flow, but required plumbing to create the account those
    /// instructions operate on. Snapshots `goal_amount` / `deadline` /
    /// `milestone_count` / `creator` immutably at this point.
    pub fn initialize_escrow(
        ctx: Context<InitializeEscrow>,
        project: Pubkey,
        goal_amount: u64,
        deadline: i64,
        milestone_count: u8,
        token_mint: Pubkey,
    ) -> Result<()> {
        require!(goal_amount > 0, EscrowError::InvalidGoalAmount);
        require!(milestone_count > 0, EscrowError::InvalidMilestoneCount);
        let now = Clock::get()?.unix_timestamp;
        require!(deadline > now, EscrowError::InvalidDeadline);

        // SECURITY: `creator` is NOT a free instruction argument — it is bound
        // to the `creator` signer, so the address that later receives every
        // milestone payout must have authorized this escrow's creation.
        //
        // SECURITY (#3): escrow terms are additionally bound on-chain to the
        // registry's ProjectAccount. `Account<ProjectAccount>` already
        // enforced owner == agent_registry::ID + the account discriminator;
        // here we require the account to BE the project and every term to
        // match it exactly, so nobody — not even through a non-AgentFund
        // client — can claim the [ESCROW_SEED, project] slot with terms that
        // differ from what the creator registered.
        let rp = &ctx.accounts.registry_project;
        require_keys_eq!(rp.key(), project, EscrowError::RegistryProjectMismatch);
        require_keys_eq!(rp.creator, ctx.accounts.creator.key(), EscrowError::InvalidCreator);
        require!(rp.goal_amount == goal_amount, EscrowError::TermsMismatch);
        require!(rp.deadline == deadline, EscrowError::TermsMismatch);
        require!(rp.milestone_count == milestone_count, EscrowError::TermsMismatch);
        require_keys_eq!(rp.token_mint, token_mint, EscrowError::TermsMismatch);
        let escrow = &mut ctx.accounts.escrow;
        escrow.project = project;
        escrow.creator = ctx.accounts.creator.key();
        escrow.token_mint = token_mint;
        escrow.goal_amount = goal_amount;
        escrow.deadline = deadline;
        escrow.milestone_count = milestone_count;
        escrow.status = CampaignStatus::Active;
        escrow.total_deposited = 0;
        escrow.released_amount = 0;
        escrow.milestone_index = 0;
        escrow.bump = ctx.bumps.escrow;

        if token_mint != native_sol_mint() {
            let mint_info = ctx
                .accounts
                .mint
                .as_ref()
                .ok_or(EscrowError::MissingTokenAccounts)?;
            let escrow_ata_info = ctx
                .accounts
                .escrow_ata
                .as_ref()
                .ok_or(EscrowError::MissingTokenAccounts)?;
            require_keys_eq!(mint_info.key(), token_mint, EscrowError::InvalidMint);

            let cpi_accounts = associated_token::Create {
                payer: ctx.accounts.payer.to_account_info(),
                associated_token: escrow_ata_info.to_account_info(),
                authority: escrow.to_account_info(),
                mint: mint_info.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            };
            let cpi_ctx = CpiContext::new(
                ctx.accounts.associated_token_program.to_account_info(),
                cpi_accounts,
            );
            associated_token::create(cpi_ctx)?;
        }

        Ok(())
    }

    /// contribute(amount): transfer contributor -> escrow (SPL ATA or
    /// native lamports). Requires the campaign to be Active and not past
    /// its deadline. Accumulates into the contributor's
    /// `ContributionAccount` with checked math.
    pub fn contribute(ctx: Context<Contribute>, project: Pubkey, amount: u64) -> Result<()> {
        require!(amount > 0, EscrowError::InvalidAmount);
        require_keys_eq!(ctx.accounts.escrow.project, project, EscrowError::ProjectMismatch);

        let now = Clock::get()?.unix_timestamp;
        require!(
            ctx.accounts.escrow.status == CampaignStatus::Active,
            EscrowError::CampaignNotActive
        );
        require!(now < ctx.accounts.escrow.deadline, EscrowError::DeadlinePassed);

        if ctx.accounts.escrow.token_mint == native_sol_mint() {
            let cpi_accounts = SystemTransfer {
                from: ctx.accounts.contributor.to_account_info(),
                to: ctx.accounts.escrow.to_account_info(),
            };
            let cpi_ctx =
                CpiContext::new(ctx.accounts.system_program.to_account_info(), cpi_accounts);
            system_program::transfer(cpi_ctx, amount)?;
        } else {
            let contributor_ata = ctx
                .accounts
                .contributor_ata
                .as_ref()
                .ok_or(EscrowError::MissingTokenAccounts)?;
            let escrow_ata = ctx
                .accounts
                .escrow_ata
                .as_ref()
                .ok_or(EscrowError::MissingTokenAccounts)?;

            let contributor_ata_data =
                TokenAccount::try_deserialize(&mut &contributor_ata.data.borrow()[..])?;
            let escrow_ata_data = TokenAccount::try_deserialize(&mut &escrow_ata.data.borrow()[..])?;
            require_keys_eq!(
                contributor_ata_data.mint,
                ctx.accounts.escrow.token_mint,
                EscrowError::InvalidMint
            );
            require_keys_eq!(
                contributor_ata_data.owner,
                ctx.accounts.contributor.key(),
                EscrowError::InvalidTokenAccount
            );
            require_keys_eq!(
                escrow_ata_data.mint,
                ctx.accounts.escrow.token_mint,
                EscrowError::InvalidMint
            );
            require_keys_eq!(
                escrow_ata_data.owner,
                ctx.accounts.escrow.key(),
                EscrowError::InvalidTokenAccount
            );

            let cpi_accounts = TokenTransfer {
                from: contributor_ata.to_account_info(),
                to: escrow_ata.to_account_info(),
                authority: ctx.accounts.contributor.to_account_info(),
            };
            let cpi_ctx =
                CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
            token::transfer(cpi_ctx, amount)?;
        }

        let escrow = &mut ctx.accounts.escrow;
        escrow.total_deposited = escrow
            .total_deposited
            .checked_add(amount)
            .ok_or(EscrowError::MathOverflow)?;

        let contribution = &mut ctx.accounts.contribution;
        if contribution.contributor == Pubkey::default() {
            contribution.contributor = ctx.accounts.contributor.key();
            contribution.project = project;
            contribution.amount = 0;
            contribution.bump = ctx.bumps.contribution;
        }
        contribution.amount = contribution
            .amount
            .checked_add(amount)
            .ok_or(EscrowError::MathOverflow)?;
        contribution.timestamp = now;

        emit!(ContributionMade {
            project,
            contributor: ctx.accounts.contributor.key(),
            amount,
            total_deposited: escrow.total_deposited,
            timestamp: now,
        });

        Ok(())
    }

    /// contribute_for(amount): like `contribute`, but the funds come from
    /// `payer` while the contribution credit (vote weight, refund rights,
    /// reputation) goes to `beneficiary`. This is the x402 settlement path:
    /// a facilitator or platform treasury settles an agent's payment and
    /// the agent — not the facilitator — becomes the on-chain contributor.
    /// Refunds of this credit are claimable only by `beneficiary`.
    pub fn contribute_for(ctx: Context<ContributeFor>, project: Pubkey, amount: u64) -> Result<()> {
        require!(amount > 0, EscrowError::InvalidAmount);
        require_keys_eq!(ctx.accounts.escrow.project, project, EscrowError::ProjectMismatch);

        let now = Clock::get()?.unix_timestamp;
        require!(
            ctx.accounts.escrow.status == CampaignStatus::Active,
            EscrowError::CampaignNotActive
        );
        require!(now < ctx.accounts.escrow.deadline, EscrowError::DeadlinePassed);

        if ctx.accounts.escrow.token_mint == native_sol_mint() {
            let cpi_accounts = SystemTransfer {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.escrow.to_account_info(),
            };
            let cpi_ctx =
                CpiContext::new(ctx.accounts.system_program.to_account_info(), cpi_accounts);
            system_program::transfer(cpi_ctx, amount)?;
        } else {
            let payer_ata = ctx
                .accounts
                .payer_ata
                .as_ref()
                .ok_or(EscrowError::MissingTokenAccounts)?;
            let escrow_ata = ctx
                .accounts
                .escrow_ata
                .as_ref()
                .ok_or(EscrowError::MissingTokenAccounts)?;

            let payer_ata_data =
                TokenAccount::try_deserialize(&mut &payer_ata.data.borrow()[..])?;
            let escrow_ata_data =
                TokenAccount::try_deserialize(&mut &escrow_ata.data.borrow()[..])?;
            require_keys_eq!(
                payer_ata_data.mint,
                ctx.accounts.escrow.token_mint,
                EscrowError::InvalidMint
            );
            require_keys_eq!(
                payer_ata_data.owner,
                ctx.accounts.payer.key(),
                EscrowError::InvalidTokenAccount
            );
            require_keys_eq!(
                escrow_ata_data.mint,
                ctx.accounts.escrow.token_mint,
                EscrowError::InvalidMint
            );
            require_keys_eq!(
                escrow_ata_data.owner,
                ctx.accounts.escrow.key(),
                EscrowError::InvalidTokenAccount
            );

            let cpi_accounts = TokenTransfer {
                from: payer_ata.to_account_info(),
                to: escrow_ata.to_account_info(),
                authority: ctx.accounts.payer.to_account_info(),
            };
            let cpi_ctx =
                CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
            token::transfer(cpi_ctx, amount)?;
        }

        let escrow = &mut ctx.accounts.escrow;
        escrow.total_deposited = escrow
            .total_deposited
            .checked_add(amount)
            .ok_or(EscrowError::MathOverflow)?;

        let contribution = &mut ctx.accounts.contribution;
        if contribution.contributor == Pubkey::default() {
            contribution.contributor = ctx.accounts.beneficiary.key();
            contribution.project = project;
            contribution.amount = 0;
            contribution.bump = ctx.bumps.contribution;
        }
        contribution.amount = contribution
            .amount
            .checked_add(amount)
            .ok_or(EscrowError::MathOverflow)?;
        contribution.timestamp = now;

        emit!(ContributionMade {
            project,
            contributor: ctx.accounts.beneficiary.key(),
            amount,
            total_deposited: escrow.total_deposited,
            timestamp: now,
        });

        Ok(())
    }

    /// vote_milestone(milestone_index, support): only wallets holding a
    /// `ContributionAccount` for this project may vote (enforced by the
    /// `contribution` PDA having to already exist). One `VoteAccount` per
    /// (voter, milestone) — `init` fails on a repeat vote. Records the
    /// voter's contributed amount as weight at vote time.
    pub fn vote_milestone(
        ctx: Context<VoteMilestone>,
        project: Pubkey,
        milestone_index: u8,
        support: bool,
    ) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require_keys_eq!(escrow.project, project, EscrowError::ProjectMismatch);
        require!(
            milestone_index < escrow.milestone_count,
            EscrowError::InvalidMilestoneIndex
        );
        require!(
            milestone_index >= escrow.milestone_index,
            EscrowError::MilestoneAlreadyReleased
        );

        let contribution = &ctx.accounts.contribution;
        require_keys_eq!(contribution.project, project, EscrowError::ProjectMismatch);
        require_keys_eq!(
            contribution.contributor,
            ctx.accounts.voter.key(),
            EscrowError::NotAContributor
        );

        let now = Clock::get()?.unix_timestamp;
        let weight = contribution.amount;

        let vote = &mut ctx.accounts.vote_account;
        vote.voter = ctx.accounts.voter.key();
        vote.project = project;
        vote.milestone_index = milestone_index;
        vote.support = support;
        vote.weight = weight;
        vote.timestamp = now;
        vote.bump = ctx.bumps.vote_account;

        emit!(VoteCast {
            project,
            voter: vote.voter,
            milestone_index,
            support,
            weight,
            timestamp: now,
        });

        Ok(())
    }

    /// release_milestone(milestone_index): milestones release strictly in
    /// order. Tallies approving weight from the `VoteAccount`s supplied
    /// as `remaining_accounts` and requires it to exceed 50% of
    /// `total_deposited`. Release amount is `total_deposited /
    /// milestone_count`, except the final milestone which sweeps the
    /// remainder. Anyone may crank this once the threshold holds; funds
    /// only ever go to the creator recorded at `initialize_escrow` time.
    pub fn release_milestone<'info>(
        ctx: Context<'_, '_, 'info, 'info, ReleaseMilestone<'info>>,
        project: Pubkey,
        milestone_index: u8,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;

        require_keys_eq!(ctx.accounts.escrow.project, project, EscrowError::ProjectMismatch);
        // CRITICAL: a milestone can only be released if the campaign actually
        // SUCCEEDED — i.e. reached its funding goal. Without this an attacker
        // could contribute a small amount, self-vote >50% of the (tiny) current
        // total_deposited, and drain the escrow before the goal is ever met.
        // Requiring goal-met here also means "goal met" (no refunds) and
        // "goal not met" (no releases) are mutually exclusive states, which is
        // what neutralises the stale-vote-weight-after-refund vector.
        require!(
            ctx.accounts.escrow.total_deposited >= ctx.accounts.escrow.goal_amount,
            EscrowError::GoalNotMet
        );
        require!(
            ctx.accounts.escrow.status == CampaignStatus::Active,
            EscrowError::CampaignNotActive
        );
        require!(
            milestone_index == ctx.accounts.escrow.milestone_index,
            EscrowError::MilestoneOutOfOrder
        );
        require!(
            ctx.accounts.escrow.milestone_index < ctx.accounts.escrow.milestone_count,
            EscrowError::AllMilestonesReleased
        );
        require_keys_eq!(
            ctx.accounts.creator.key(),
            ctx.accounts.escrow.creator,
            EscrowError::InvalidCreator
        );

        // Tally approving weight from the supplied VoteAccount PDAs.
        // Every account is re-validated (owner + discriminator via
        // `Account::try_from`, plus project/milestone match) and deduped
        // by pubkey so a caller can't inflate approval by repeating the
        // same vote account.
        let mut approving_weight: u64 = 0;
        let mut seen: Vec<Pubkey> = Vec::with_capacity(ctx.remaining_accounts.len());
        for account_info in ctx.remaining_accounts.iter() {
            if seen.contains(account_info.key) {
                return err!(EscrowError::DuplicateVoteAccount);
            }
            seen.push(*account_info.key);

            let vote: Account<VoteAccount> =
                Account::try_from(account_info).map_err(|_| error!(EscrowError::InvalidVoteAccount))?;
            require_keys_eq!(vote.project, project, EscrowError::VoteProjectMismatch);
            require!(
                vote.milestone_index == milestone_index,
                EscrowError::VoteMilestoneMismatch
            );

            if vote.support {
                approving_weight = approving_weight
                    .checked_add(vote.weight)
                    .ok_or(EscrowError::MathOverflow)?;
            }
        }

        let total_deposited = ctx.accounts.escrow.total_deposited;
        require!(
            (approving_weight as u128) * 2 > (total_deposited as u128),
            EscrowError::InsufficientApproval
        );

        let milestone_count = ctx.accounts.escrow.milestone_count;
        let released_amount = ctx.accounts.escrow.released_amount;
        let release_amount = if milestone_index == milestone_count - 1 {
            // Last milestone sweeps whatever remains.
            total_deposited
                .checked_sub(released_amount)
                .ok_or(EscrowError::MathOverflow)?
        } else {
            total_deposited
                .checked_div(milestone_count as u64)
                .ok_or(EscrowError::MathOverflow)?
        };

        if ctx.accounts.escrow.token_mint == native_sol_mint() {
            let escrow_info = ctx.accounts.escrow.to_account_info();
            let creator_info = ctx.accounts.creator.to_account_info();
            let mut from_lamports = escrow_info.try_borrow_mut_lamports()?;
            let mut to_lamports = creator_info.try_borrow_mut_lamports()?;
            **from_lamports = from_lamports
                .checked_sub(release_amount)
                .ok_or(EscrowError::MathOverflow)?;
            **to_lamports = to_lamports
                .checked_add(release_amount)
                .ok_or(EscrowError::MathOverflow)?;
        } else {
            let escrow_ata = ctx
                .accounts
                .escrow_ata
                .as_ref()
                .ok_or(EscrowError::MissingTokenAccounts)?;
            let creator_ata = ctx
                .accounts
                .creator_ata
                .as_ref()
                .ok_or(EscrowError::MissingTokenAccounts)?;

            let escrow_ata_data = TokenAccount::try_deserialize(&mut &escrow_ata.data.borrow()[..])?;
            let creator_ata_data = TokenAccount::try_deserialize(&mut &creator_ata.data.borrow()[..])?;
            require_keys_eq!(
                escrow_ata_data.mint,
                ctx.accounts.escrow.token_mint,
                EscrowError::InvalidMint
            );
            require_keys_eq!(
                creator_ata_data.mint,
                ctx.accounts.escrow.token_mint,
                EscrowError::InvalidMint
            );
            require_keys_eq!(
                creator_ata_data.owner,
                ctx.accounts.escrow.creator,
                EscrowError::InvalidTokenAccount
            );

            let project_key = ctx.accounts.escrow.project;
            let bump = ctx.accounts.escrow.bump;
            let seeds: &[&[u8]] = &[ESCROW_SEED, project_key.as_ref(), &[bump]];
            let signer_seeds: &[&[&[u8]]] = &[seeds];

            let cpi_accounts = TokenTransfer {
                from: escrow_ata.to_account_info(),
                to: creator_ata.to_account_info(),
                authority: ctx.accounts.escrow.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            );
            token::transfer(cpi_ctx, release_amount)?;
        }

        let escrow = &mut ctx.accounts.escrow;
        escrow.released_amount = escrow
            .released_amount
            .checked_add(release_amount)
            .ok_or(EscrowError::MathOverflow)?;
        escrow.milestone_index = escrow
            .milestone_index
            .checked_add(1)
            .ok_or(EscrowError::MathOverflow)?;
        if escrow.milestone_index == escrow.milestone_count {
            escrow.status = CampaignStatus::Completed;
        }

        emit!(MilestoneReleased {
            project,
            milestone_index,
            amount: release_amount,
            creator: escrow.creator,
            total_released: escrow.released_amount,
            timestamp: now,
        });

        Ok(())
    }

    /// refund(): only once the deadline has passed, the goal was not
    /// met, and nothing has been released yet. Returns the caller's full
    /// `ContributionAccount.amount` from escrow, then zeroes and closes
    /// the account back to the contributor (recovering rent).
    pub fn refund(ctx: Context<Refund>, project: Pubkey) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require_keys_eq!(ctx.accounts.escrow.project, project, EscrowError::ProjectMismatch);
        require!(now > ctx.accounts.escrow.deadline, EscrowError::DeadlineNotPassed);
        require!(
            ctx.accounts.escrow.total_deposited < ctx.accounts.escrow.goal_amount,
            EscrowError::GoalMet
        );
        require!(ctx.accounts.escrow.released_amount == 0, EscrowError::AlreadyReleased);

        let amount = ctx.accounts.contribution.amount;
        require!(amount > 0, EscrowError::NothingToRefund);

        if ctx.accounts.escrow.token_mint == native_sol_mint() {
            let escrow_info = ctx.accounts.escrow.to_account_info();
            let contributor_info = ctx.accounts.contributor.to_account_info();
            let mut from_lamports = escrow_info.try_borrow_mut_lamports()?;
            let mut to_lamports = contributor_info.try_borrow_mut_lamports()?;
            **from_lamports = from_lamports
                .checked_sub(amount)
                .ok_or(EscrowError::MathOverflow)?;
            **to_lamports = to_lamports
                .checked_add(amount)
                .ok_or(EscrowError::MathOverflow)?;
        } else {
            let escrow_ata = ctx
                .accounts
                .escrow_ata
                .as_ref()
                .ok_or(EscrowError::MissingTokenAccounts)?;
            let contributor_ata = ctx
                .accounts
                .contributor_ata
                .as_ref()
                .ok_or(EscrowError::MissingTokenAccounts)?;

            let escrow_ata_data = TokenAccount::try_deserialize(&mut &escrow_ata.data.borrow()[..])?;
            let contributor_ata_data =
                TokenAccount::try_deserialize(&mut &contributor_ata.data.borrow()[..])?;
            require_keys_eq!(
                escrow_ata_data.mint,
                ctx.accounts.escrow.token_mint,
                EscrowError::InvalidMint
            );
            require_keys_eq!(
                contributor_ata_data.mint,
                ctx.accounts.escrow.token_mint,
                EscrowError::InvalidMint
            );
            require_keys_eq!(
                contributor_ata_data.owner,
                ctx.accounts.contributor.key(),
                EscrowError::InvalidTokenAccount
            );

            let project_key = ctx.accounts.escrow.project;
            let bump = ctx.accounts.escrow.bump;
            let seeds: &[&[u8]] = &[ESCROW_SEED, project_key.as_ref(), &[bump]];
            let signer_seeds: &[&[&[u8]]] = &[seeds];

            let cpi_accounts = TokenTransfer {
                from: escrow_ata.to_account_info(),
                to: contributor_ata.to_account_info(),
                authority: ctx.accounts.escrow.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            );
            token::transfer(cpi_ctx, amount)?;
        }

        let escrow = &mut ctx.accounts.escrow;
        escrow.total_deposited = escrow
            .total_deposited
            .checked_sub(amount)
            .ok_or(EscrowError::MathOverflow)?;

        emit!(Refunded {
            project,
            contributor: ctx.accounts.contributor.key(),
            amount,
            timestamp: now,
        });

        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────

/// Escrow-local campaign status. Deliberately smaller than
/// `agent_registry`'s `ProjectStatus` (Active/Funded/Failed/Complete) —
/// this program only needs to know whether it should still accept
/// contributions (`Active`) or has fully paid out (`Completed`); the
/// richer status lives on `ProjectAccount` in the registry program.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum CampaignStatus {
    Active,
    Completed,
}

#[account]
pub struct EscrowAccount {
    /// Opaque project identifier (matches the `project` argument used as
    /// a PDA seed on every instruction, and the corresponding
    /// `ProjectAccount` pubkey on the registry side).
    pub project: Pubkey,
    /// Snapshot of the project creator at `initialize_escrow` time.
    /// Immutable thereafter — `release_milestone` only ever pays this
    /// address.
    pub creator: Pubkey,
    /// SPL mint, or the native-SOL sentinel (`NATIVE_SOL_MINT`).
    pub token_mint: Pubkey,
    /// Snapshot of the funding goal at `initialize_escrow` time.
    pub goal_amount: u64,
    /// Snapshot of the campaign deadline (unix seconds) at
    /// `initialize_escrow` time.
    pub deadline: i64,
    /// Snapshot of the milestone count at `initialize_escrow` time.
    pub milestone_count: u8,
    pub status: CampaignStatus,
    pub total_deposited: u64,
    pub released_amount: u64,
    /// Index of the next milestone eligible for release.
    pub milestone_index: u8,
    pub bump: u8,
}

impl EscrowAccount {
    // 32 (project) + 32 (creator) + 32 (token_mint) + 8 (goal_amount)
    // + 8 (deadline) + 1 (milestone_count) + 1 (status, fieldless enum
    // => 1 byte under Borsh) + 8 (total_deposited) + 8 (released_amount)
    // + 1 (milestone_index) + 1 (bump) = 132
    pub const LEN: usize = 32 + 32 + 32 + 8 + 8 + 1 + 1 + 8 + 8 + 1 + 1;
}

#[account]
pub struct ContributionAccount {
    pub contributor: Pubkey,
    pub project: Pubkey,
    /// Cumulative amount contributed across all `contribute` calls.
    pub amount: u64,
    /// Timestamp of the most recent contribution.
    pub timestamp: i64,
    pub bump: u8,
}

impl ContributionAccount {
    // 32 (contributor) + 32 (project) + 8 (amount) + 8 (timestamp) + 1 (bump) = 81
    pub const LEN: usize = 32 + 32 + 8 + 8 + 1;
}

#[account]
pub struct VoteAccount {
    pub voter: Pubkey,
    pub project: Pubkey,
    pub milestone_index: u8,
    pub support: bool,
    /// Voter's `ContributionAccount.amount` snapshotted at vote time.
    pub weight: u64,
    pub timestamp: i64,
    pub bump: u8,
}

impl VoteAccount {
    // 32 (voter) + 32 (project) + 1 (milestone_index) + 1 (support)
    // + 8 (weight) + 8 (timestamp) + 1 (bump) = 83
    pub const LEN: usize = 32 + 32 + 1 + 1 + 8 + 8 + 1;
}

// ─────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────

#[event]
pub struct ContributionMade {
    pub project: Pubkey,
    pub contributor: Pubkey,
    pub amount: u64,
    pub total_deposited: u64,
    pub timestamp: i64,
}

#[event]
pub struct VoteCast {
    pub project: Pubkey,
    pub voter: Pubkey,
    pub milestone_index: u8,
    pub support: bool,
    pub weight: u64,
    pub timestamp: i64,
}

#[event]
pub struct MilestoneReleased {
    pub project: Pubkey,
    pub milestone_index: u8,
    pub amount: u64,
    pub creator: Pubkey,
    pub total_released: u64,
    pub timestamp: i64,
}

#[event]
pub struct Refunded {
    pub project: Pubkey,
    pub contributor: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

// ─────────────────────────────────────────────────────────────
// Accounts contexts
// ─────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(project: Pubkey, goal_amount: u64, deadline: i64, milestone_count: u8, token_mint: Pubkey)]
pub struct InitializeEscrow<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The project creator — must sign, and is the ONLY address milestone
    /// releases will ever pay. Bound into `escrow.creator` at init.
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + EscrowAccount::LEN,
        seeds = [ESCROW_SEED, project.as_ref()],
        bump,
    )]
    pub escrow: Account<'info, EscrowAccount>,

    /// The agent_registry ProjectAccount this escrow funds. Owner +
    /// discriminator are enforced by `Account`; the handler additionally
    /// requires its key to equal `project` and all terms to match it.
    pub registry_project: Account<'info, ProjectAccount>,

    /// SPL-only: the project's mint. `None` for native SOL campaigns.
    pub mint: Option<UncheckedAccount<'info>>,

    /// SPL-only: escrow's associated token account, created here with
    /// the escrow PDA as authority. `None` for native SOL campaigns.
    #[account(mut)]
    pub escrow_ata: Option<UncheckedAccount<'info>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(project: Pubkey, amount: u64)]
pub struct Contribute<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, project.as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, EscrowAccount>,

    #[account(
        init_if_needed,
        payer = contributor,
        space = 8 + ContributionAccount::LEN,
        seeds = [CONTRIBUTION_SEED, project.as_ref(), contributor.key().as_ref()],
        bump,
    )]
    pub contribution: Account<'info, ContributionAccount>,

    #[account(mut)]
    pub contributor: Signer<'info>,

    /// SPL-only: contributor's ATA for `escrow.token_mint`. `None` for
    /// native SOL contributions.
    #[account(mut)]
    pub contributor_ata: Option<UncheckedAccount<'info>>,

    /// SPL-only: escrow's ATA. `None` for native SOL contributions.
    #[account(mut)]
    pub escrow_ata: Option<UncheckedAccount<'info>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(project: Pubkey)]
pub struct ContributeFor<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, project.as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, EscrowAccount>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + ContributionAccount::LEN,
        seeds = [CONTRIBUTION_SEED, project.as_ref(), beneficiary.key().as_ref()],
        bump,
    )]
    pub contribution: Account<'info, ContributionAccount>,

    /// Funds source — pays the contribution and any account rent.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: pure identity — the wallet credited with this contribution
    /// (contribution PDA seed, vote weight, refund recipient). Never read
    /// or written by this instruction.
    pub beneficiary: UncheckedAccount<'info>,

    /// SPL-only: payer's ATA for `escrow.token_mint`. `None` for native SOL.
    #[account(mut)]
    pub payer_ata: Option<UncheckedAccount<'info>>,

    /// SPL-only: escrow's ATA. `None` for native SOL contributions.
    #[account(mut)]
    pub escrow_ata: Option<UncheckedAccount<'info>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(project: Pubkey, milestone_index: u8, support: bool)]
pub struct VoteMilestone<'info> {
    #[account(
        seeds = [ESCROW_SEED, project.as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, EscrowAccount>,

    /// Must already exist — its absence (uninitialized PDA) is exactly
    /// what rejects non-contributors from voting.
    #[account(
        seeds = [CONTRIBUTION_SEED, project.as_ref(), voter.key().as_ref()],
        bump = contribution.bump,
    )]
    pub contribution: Account<'info, ContributionAccount>,

    #[account(
        init,
        payer = voter,
        space = 8 + VoteAccount::LEN,
        seeds = [VOTE_SEED, project.as_ref(), voter.key().as_ref(), &[milestone_index]],
        bump,
    )]
    pub vote_account: Account<'info, VoteAccount>,

    #[account(mut)]
    pub voter: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(project: Pubkey, milestone_index: u8)]
pub struct ReleaseMilestone<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, project.as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, EscrowAccount>,

    /// Recorded project creator; funds are only ever released here.
    /// Anyone may sign/pay for this instruction (it's a permissionless
    /// crank once the vote threshold holds) — `creator` need not sign.
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,

    /// SPL-only: escrow's ATA (source). `None` for native SOL.
    #[account(mut)]
    pub escrow_ata: Option<UncheckedAccount<'info>>,

    /// SPL-only: creator's ATA (destination). `None` for native SOL.
    #[account(mut)]
    pub creator_ata: Option<UncheckedAccount<'info>>,

    pub token_program: Program<'info, Token>,
    // Additional VoteAccount PDAs for (project, milestone_index) are
    // passed via `ctx.remaining_accounts` and validated/tallied in the
    // handler.
}

#[derive(Accounts)]
#[instruction(project: Pubkey)]
pub struct Refund<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, project.as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, EscrowAccount>,

    #[account(
        mut,
        seeds = [CONTRIBUTION_SEED, project.as_ref(), contributor.key().as_ref()],
        bump = contribution.bump,
        close = contributor,
    )]
    pub contribution: Account<'info, ContributionAccount>,

    #[account(mut)]
    pub contributor: Signer<'info>,

    /// SPL-only: escrow's ATA (source). `None` for native SOL.
    #[account(mut)]
    pub escrow_ata: Option<UncheckedAccount<'info>>,

    /// SPL-only: contributor's ATA (destination). `None` for native SOL.
    #[account(mut)]
    pub contributor_ata: Option<UncheckedAccount<'info>>,

    pub token_program: Program<'info, Token>,
}

// ─────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────

#[error_code]
pub enum EscrowError {
    #[msg("Goal amount must be greater than zero")]
    InvalidGoalAmount,
    #[msg("Deadline must be strictly in the future")]
    InvalidDeadline,
    #[msg("Milestone count must be greater than zero")]
    InvalidMilestoneCount,
    #[msg("Contribution amount must be greater than zero")]
    InvalidAmount,
    #[msg("Supplied project does not match this escrow account")]
    ProjectMismatch,
    #[msg("Campaign is not active")]
    CampaignNotActive,
    #[msg("Campaign deadline has already passed")]
    DeadlinePassed,
    #[msg("Campaign deadline has not passed yet")]
    DeadlineNotPassed,
    #[msg("Campaign goal was met; refunds are not available")]
    GoalMet,
    #[msg("Campaign goal has not been reached; milestones cannot be released")]
    GoalNotMet,
    #[msg("Funds have already been released for this campaign")]
    AlreadyReleased,
    #[msg("Nothing to refund for this contributor")]
    NothingToRefund,
    #[msg("Caller does not have a contribution to this project")]
    NotAContributor,
    #[msg("Milestone index is out of range")]
    InvalidMilestoneIndex,
    #[msg("This milestone has already been released")]
    MilestoneAlreadyReleased,
    #[msg("Milestones must be released strictly in order")]
    MilestoneOutOfOrder,
    #[msg("All milestones have already been released")]
    AllMilestonesReleased,
    #[msg("Approving vote weight does not exceed 50% of total deposits")]
    InsufficientApproval,
    #[msg("Supplied account is not a valid VoteAccount owned by this program")]
    InvalidVoteAccount,
    #[msg("Vote account project does not match the requested project")]
    VoteProjectMismatch,
    #[msg("Vote account milestone does not match the requested milestone")]
    VoteMilestoneMismatch,
    #[msg("Duplicate vote account supplied in remaining_accounts")]
    DuplicateVoteAccount,
    #[msg("Recorded project creator does not match supplied creator account")]
    InvalidCreator,
    #[msg("Token account mint does not match escrow's token mint")]
    InvalidMint,
    #[msg("Token account owner/authority mismatch")]
    InvalidTokenAccount,
    #[msg("SPL escrow requires mint/token accounts to be supplied")]
    MissingTokenAccounts,
    #[msg("Checked math overflow or underflow")]
    MathOverflow,
    #[msg("Supplied registry project account is not the requested project")]
    RegistryProjectMismatch,
    #[msg("Escrow terms do not match the registered project's terms")]
    TermsMismatch,
}
