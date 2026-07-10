/**
 * Zod input schemas for MCP tool parameters. Kept local to this
 * workspace (rather than importing @agentfund/shared's zod schemas)
 * because the MCP SDK pins a newer zod peer range (^3.25 || ^4.0) than
 * @agentfund/shared currently declares (^3.23.8) — mixing two zod
 * copies' schema objects across a package boundary is fragile, so this
 * file re-declares the small subset of shapes MCP tools need against
 * this workspace's own zod install. Keep these in sync with
 * shared/src/schemas.ts if the on-chain/API shapes change.
 */
import { z } from "zod";

/** Loose base58 pubkey check: 32-44 chars, base58 alphabet. */
export const pubkeySchema = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid base58 Solana pubkey");

export const supportedTokenSchema = z.enum(["SOL", "USDC"]);

export const projectStatusSchema = z.enum(["Active", "Funded", "Failed", "Complete"]);

export const milestoneInputSchema = z.object({
  description: z.string().min(1).describe("Human-readable description of what completes this milestone"),
  amount: z
    .number()
    .int()
    .positive()
    .describe("Base units (lamports for SOL, micro-USDC for USDC) released when this milestone passes"),
});
