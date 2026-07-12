import { z } from "zod";
import { supportedTokenSchema, projectStatusSchema } from "@agentfund/shared";
import { base58PubkeySchema, paginationQuerySchema } from "./common.js";

/** GET /projects — filter: status, token, minGoal, category, sort */
export const listProjectsQuerySchema = paginationQuerySchema.extend({
  status: projectStatusSchema.optional(),
  token: supportedTokenSchema.optional(),
  minGoal: z.coerce.number().int().nonnegative().optional(),
  category: z.string().optional(),
  sort: z.enum(["newest", "oldest", "goal", "raised", "deadline"]).optional().default("newest"),
});
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

const milestoneInputSchema = z.object({
  description: z.string().min(1).max(500),
  amount: z.number().int().positive(),
});

/**
 * POST /projects body. The API pins {title, description, image, category}
 * to IPFS (services/ipfs.ts) to produce the `ipfsHash` the on-chain
 * `create_project` instruction expects, then builds the unsigned tx.
 */
export const createProjectBodySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  image: z.string().url().optional(),
  category: z.string().optional(),
  /** Link to the project's source repo, so an evaluating agent can inspect the code before contributing. */
  repoUrl: z.string().url().optional(),
  website: z.string().url().optional(),
  twitter: z.string().url().optional(),
  goalAmount: z.number().int().positive(),
  token: supportedTokenSchema,
  /** Unix seconds; must be in the future. */
  deadline: z.number().int().positive(),
  milestones: z.array(milestoneInputSchema).min(1).max(10),
});
export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;

export const contributeBodySchema = z.object({
  amount: z.number().int().positive(),
});
export type ContributeBody = z.infer<typeof contributeBodySchema>;

export const voteBodySchema = z.object({
  milestoneIndex: z.number().int().min(0).max(255),
  support: z.boolean(),
});
export type VoteBody = z.infer<typeof voteBodySchema>;

export const projectIdParamSchema = z.object({
  id: base58PubkeySchema,
});
