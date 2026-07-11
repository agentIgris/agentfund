use anchor_lang::prelude::*;

// Placeholder program id — replaced with the value of REGISTRY_PROGRAM_ID
// (env) once deployed. Keep in sync with Anchor.toml.
declare_id!("2TqDeKaadPUeBcgaXXqYAqddfZngUfbq4m8iDSyePSBA");

// ─────────────────────────────────────────────────────────────
// PDA seeds — must match shared/src/constants.ts PDA_SEEDS byte-for-byte.
// ─────────────────────────────────────────────────────────────

pub const CONFIG_SEED: &[u8] = b"config";
pub const AGENT_SEED: &[u8] = b"agent";
pub const PROJECT_SEED: &[u8] = b"project";

// ─────────────────────────────────────────────────────────────
// Validation limits
// ─────────────────────────────────────────────────────────────

pub const MAX_METADATA_URI_LEN: usize = 200;
pub const MAX_IPFS_HASH_LEN: usize = 128;
pub const MIN_MILESTONES: u8 = 1;
pub const MAX_MILESTONES: u8 = 10;

#[program]
pub mod agent_registry {
    use super::*;

    /// Initializes the platform-wide Config PDA, storing the platform
    /// authority pubkey that (alongside a project's own creator) is
    /// permitted to call `update_project_status`. Callable once — the
    /// `init` constraint on `config` rejects a second invocation.
    pub fn initialize(ctx: Context<Initialize>, authority: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = authority;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Registers the calling wallet as an agent, creating its
    /// AgentAccount PDA (seeds = ["agent", owner]).
    pub fn register_agent(ctx: Context<RegisterAgent>, metadata_uri: String) -> Result<()> {
        require!(
            metadata_uri.len() <= MAX_METADATA_URI_LEN,
            RegistryError::MetadataUriTooLong
        );

        let agent = &mut ctx.accounts.agent;
        agent.owner = ctx.accounts.owner.key();
        agent.metadata_uri = metadata_uri.clone();
        agent.reputation_score = 0;
        agent.projects_created = 0;
        agent.total_contributed = 0;
        agent.bump = ctx.bumps.agent;

        emit!(AgentRegistered {
            owner: agent.owner,
            metadata_uri,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Creates a new ProjectAccount PDA
    /// (seeds = ["project", creator, project_index_le_bytes]) owned by
    /// the calling agent, and increments the agent's `projects_created`
    /// counter.
    pub fn create_project(
        ctx: Context<CreateProject>,
        ipfs_hash: String,
        goal_amount: u64,
        token_mint: Pubkey,
        deadline: i64,
        milestone_count: u8,
    ) -> Result<()> {
        require!(
            ipfs_hash.len() <= MAX_IPFS_HASH_LEN,
            RegistryError::IpfsHashTooLong
        );

        let now = Clock::get()?.unix_timestamp;
        require!(deadline > now, RegistryError::InvalidDeadline);
        require!(goal_amount > 0, RegistryError::InvalidGoalAmount);
        require!(
            (MIN_MILESTONES..=MAX_MILESTONES).contains(&milestone_count),
            RegistryError::InvalidMilestoneCount
        );

        // The account-validation phase already derived `project`'s PDA
        // from the agent's pre-increment `projects_created` value, so
        // that same value is the project's canonical index.
        let agent = &mut ctx.accounts.agent;
        let project_index = agent.projects_created;
        agent.projects_created = agent
            .projects_created
            .checked_add(1)
            .ok_or(RegistryError::Overflow)?;

        let project = &mut ctx.accounts.project;
        project.creator = ctx.accounts.creator.key();
        project.ipfs_hash = ipfs_hash.clone();
        project.goal_amount = goal_amount;
        project.token_mint = token_mint;
        project.raised_amount = 0;
        project.deadline = deadline;
        project.status = ProjectStatus::Active;
        project.milestone_count = milestone_count;
        project.project_index = project_index;
        project.created_at = now;
        project.bump = ctx.bumps.project;

        emit!(ProjectCreated {
            project: project.key(),
            creator: project.creator,
            project_index,
            ipfs_hash,
            goal_amount,
            token_mint,
            deadline,
            milestone_count,
            timestamp: now,
        });

        Ok(())
    }

    /// Updates a project's status. Restricted to the project's own
    /// creator or the platform authority stored in the Config PDA.
    pub fn update_project_status(
        ctx: Context<UpdateProjectStatus>,
        status: ProjectStatus,
    ) -> Result<()> {
        let signer = ctx.accounts.authority.key();
        let is_creator = signer == ctx.accounts.project.creator;
        let is_platform_authority = signer == ctx.accounts.config.authority;
        require!(
            is_creator || is_platform_authority,
            RegistryError::Unauthorized
        );

        let project = &mut ctx.accounts.project;
        let old_status = project.status;
        project.status = status;

        emit!(ProjectStatusChanged {
            project: project.key(),
            old_status,
            new_status: status,
            changed_by: signer,
            timestamp: Clock::get()?.unix_timestamp,
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
pub struct RegisterAgent<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + AgentAccount::INIT_SPACE,
        seeds = [AGENT_SEED, owner.key().as_ref()],
        bump
    )]
    pub agent: Account<'info, AgentAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateProject<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [AGENT_SEED, creator.key().as_ref()],
        bump = agent.bump,
    )]
    pub agent: Account<'info, AgentAccount>,

    #[account(
        init,
        payer = creator,
        space = 8 + ProjectAccount::INIT_SPACE,
        seeds = [PROJECT_SEED, creator.key().as_ref(), &agent.projects_created.to_le_bytes()],
        bump
    )]
    pub project: Account<'info, ProjectAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateProjectStatus<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [PROJECT_SEED, project.creator.as_ref(), &project.project_index.to_le_bytes()],
        bump = project.bump,
    )]
    pub project: Account<'info, ProjectAccount>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,
}

// ─────────────────────────────────────────────────────────────
// Account state
// ─────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct Config {
    /// Platform authority pubkey — may update any project's status
    /// alongside that project's own creator.
    pub authority: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct AgentAccount {
    /// Agent's wallet — also the PDA seed + identity.
    pub owner: Pubkey,
    /// IPFS link to agent metadata.
    #[max_len(MAX_METADATA_URI_LEN)]
    pub metadata_uri: String,
    pub reputation_score: u64,
    pub projects_created: u32,
    pub total_contributed: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ProjectAccount {
    pub creator: Pubkey,
    /// IPFS hash containing title, description, image.
    #[max_len(MAX_IPFS_HASH_LEN)]
    pub ipfs_hash: String,
    /// In lamports (native SOL) or USDC micro-units, per `token_mint`.
    pub goal_amount: u64,
    /// SOL sentinel mint or the cluster's USDC mint.
    pub token_mint: Pubkey,
    pub raised_amount: u64,
    /// Unix seconds.
    pub deadline: i64,
    pub status: ProjectStatus,
    pub milestone_count: u8,
    /// This creator's project sequence number — also the PDA seed,
    /// snapshotted from AgentAccount.projects_created at creation time.
    pub project_index: u32,
    /// Unix seconds.
    pub created_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum ProjectStatus {
    Active,
    Funded,
    Failed,
    Complete,
}

// ─────────────────────────────────────────────────────────────
// Events — consumed by the off-chain Helius indexer.
// ─────────────────────────────────────────────────────────────

#[event]
pub struct AgentRegistered {
    pub owner: Pubkey,
    pub metadata_uri: String,
    pub timestamp: i64,
}

#[event]
pub struct ProjectCreated {
    pub project: Pubkey,
    pub creator: Pubkey,
    pub project_index: u32,
    pub ipfs_hash: String,
    pub goal_amount: u64,
    pub token_mint: Pubkey,
    pub deadline: i64,
    pub milestone_count: u8,
    pub timestamp: i64,
}

#[event]
pub struct ProjectStatusChanged {
    pub project: Pubkey,
    pub old_status: ProjectStatus,
    pub new_status: ProjectStatus,
    pub changed_by: Pubkey,
    pub timestamp: i64,
}

// ─────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────

#[error_code]
pub enum RegistryError {
    #[msg("Agent metadata URI exceeds the maximum length of 200 characters.")]
    MetadataUriTooLong,
    #[msg("Project IPFS hash exceeds the maximum allowed length.")]
    IpfsHashTooLong,
    #[msg("Project deadline must be strictly in the future.")]
    InvalidDeadline,
    #[msg("Project goal amount must be greater than zero.")]
    InvalidGoalAmount,
    #[msg("Milestone count must be between 1 and 10 inclusive.")]
    InvalidMilestoneCount,
    #[msg("Only the project creator or the platform authority may perform this action.")]
    Unauthorized,
    #[msg("Arithmetic overflow occurred while updating account state.")]
    Overflow,
}
