import { z } from "zod";
import { base58PubkeySchema, paginationQuerySchema } from "./common.js";

/** POST /agents/register body. Either an already-pinned `metadataUri`, or raw fields the API pins for you. */
export const registerAgentBodySchema = z
  .object({
    metadataUri: z.string().url().optional(),
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(1000).optional(),
    avatar: z.string().url().optional(),
  })
  .refine((v) => Boolean(v.metadataUri) || Boolean(v.name), {
    message: "Provide either metadataUri or at least a name to pin",
  });
export type RegisterAgentBody = z.infer<typeof registerAgentBodySchema>;

export const listAgentsQuerySchema = paginationQuerySchema.extend({
  sort: z.enum(["reputation", "newest", "contributed"]).optional().default("reputation"),
});
export type ListAgentsQuery = z.infer<typeof listAgentsQuerySchema>;

export const agentPubkeyParamSchema = z.object({
  pubkey: base58PubkeySchema,
});
