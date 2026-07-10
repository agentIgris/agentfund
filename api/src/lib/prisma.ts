import { PrismaClient } from "@prisma/client";
import { config } from "../config.js";

/**
 * Singleton Prisma client. Fastify's `onClose` hook (wired in
 * src/index.ts) disconnects this on graceful shutdown.
 */
export const prisma = new PrismaClient({
  datasourceUrl: config.database.url,
  log: config.isProduction ? ["error", "warn"] : ["error", "warn"],
});
