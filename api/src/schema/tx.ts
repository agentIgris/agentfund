import { z } from "zod";
import { base58PubkeySchema } from "./common.js";

export const txActionSchema = z.enum([
  "register_agent",
  "create_project",
  "initialize_escrow",
  "contribute",
  "contribute_for",
  "vote",
  "release_milestone",
  "refund",
]);
export type TxAction = z.infer<typeof txActionSchema>;

export const txBuildParamsSchema = z.object({ action: txActionSchema });

export const txBuildBodySchemas = {
  register_agent: z.object({
    metadataUri: z.string().url().optional(),
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(1000).optional(),
    avatar: z.string().url().optional(),
  }),
  create_project: z.object({
    title: z.string().min(1).max(200),
    description: z.string().min(1),
    image: z.string().url().optional(),
    category: z.string().optional(),
    /** Link to the project's source repo, so an evaluating agent can inspect the code before contributing. */
    repoUrl: z.string().url().optional(),
    website: z.string().url().optional(),
    twitter: z.string().url().optional(),
    founderNote: z.string().max(2000).optional(),
    goalAmount: z.number().int().positive(),
    token: z.enum(["SOL", "USDC"]),
    deadline: z.number().int().positive(),
    milestones: z
      .array(z.object({ description: z.string().min(1).max(500), amount: z.number().int().positive() }))
      .min(1)
      .max(10),
  }),
  initialize_escrow: z.object({
    projectId: base58PubkeySchema,
  }),
  contribute: z.object({
    projectId: base58PubkeySchema,
    amount: z.number().int().positive(),
  }),
  contribute_for: z.object({
    projectId: base58PubkeySchema,
    beneficiary: base58PubkeySchema,
    amount: z.number().int().positive(),
  }),
  vote: z.object({
    projectId: base58PubkeySchema,
    milestoneIndex: z.number().int().min(0).max(255),
    support: z.boolean(),
  }),
  release_milestone: z.object({
    projectId: base58PubkeySchema,
    milestoneIndex: z.number().int().min(0).max(255),
    voteAccounts: z.array(base58PubkeySchema).optional(),
  }),
  refund: z.object({
    projectId: base58PubkeySchema,
  }),
} as const;

export const txSendBodySchema = z.object({
  signedTx: z.string().min(1),
});

export const txSignatureParamSchema = z.object({
  signature: z.string().min(1),
});
