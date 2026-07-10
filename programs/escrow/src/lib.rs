use anchor_lang::prelude::*;

// Placeholder program id — replaced with the value of ESCROW_PROGRAM_ID
// (env) once deployed. Keep in sync with Anchor.toml.
declare_id!("Escrw1111111111111111111111111111111111111");

#[program]
pub mod escrow {
    use super::*;

    // Instructions (contribute, release_milestone, refund) and account
    // structs (EscrowAccount, ContributionAccount, VoteAccount) are
    // implemented by the program builder per implementation_plan.md.
}
