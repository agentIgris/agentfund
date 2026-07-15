import { z } from "zod";
import { base58PubkeySchema } from "./common.js";

export const x402ProjectParamSchema = z.object({
  projectId: base58PubkeySchema,
});

export const x402DonateBodySchema = z.object({
  amount: z.number().int().positive(),
  payer: base58PubkeySchema.optional(),
});

/**
 * Loose shape of the JSON embedded (base64-encoded) in the `X-PAYMENT`
 * request header. Kept permissive on `x402Version`/`network` so the route
 * can reject with a specific `invalid_payment` reason per field rather than
 * a generic zod flatten — only `scheme` and `payload.signedTx` are load-bearing.
 */
export const x402PaymentHeaderSchema = z.object({
  x402Version: z.number().optional(),
  scheme: z.string(),
  network: z.string().optional(),
  payload: z.object({
    signedTx: z.string().min(1),
  }),
  svs: z.object({
    actionRecordId: z.string().min(1),
    botId: z.string().min(1),
  }).optional(),
});
