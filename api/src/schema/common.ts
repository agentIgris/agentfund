import { z } from "zod";

/** Loose base58 pubkey check — mirrors @agentfund/shared's schemas.ts (not itself exported there). */
export const base58PubkeySchema = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid base58 pubkey");

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
