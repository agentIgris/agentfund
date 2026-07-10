/**
 * Recursively converts `bigint` fields (as returned by Prisma for
 * BigInt columns) into plain `number`, so responses match the `number`
 * fields declared on the shared types/schemas. Safe here because all
 * BigInt columns in prisma/schema.prisma hold Solana base-unit amounts
 * (lamports / micro-USDC) or unix-second timestamps, both well within
 * Number.MAX_SAFE_INTEGER for any realistic campaign size.
 */
export function serializeBigInts<T>(value: T): T {
  if (typeof value === "bigint") {
    return Number(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => serializeBigInts(v)) as unknown as T;
  }
  if (value instanceof Date) {
    return value.toISOString() as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializeBigInts(v);
    }
    return out as unknown as T;
  }
  return value;
}
