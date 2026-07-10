import { z } from "zod";

const wsChannelLikeSchema = z.union([
  z.enum(["projects", "contributions", "votes"]),
  z.string().regex(/^project:.+$/),
]);

/** POST /webhooks body — register an agent callback URL for event delivery. */
export const registerWebhookBodySchema = z.object({
  url: z.string().url(),
  events: z.array(wsChannelLikeSchema).min(1),
  /** Optional caller-supplied HMAC secret; falls back to a generated one if omitted. */
  secret: z.string().min(16).optional(),
});
export type RegisterWebhookBody = z.infer<typeof registerWebhookBodySchema>;
