import "@fastify/jwt";

/** JWT payload shape issued by POST /auth/verify — contains only the wallet pubkey (spec: "JWT ... containing the wallet pubkey"). */
export interface AgentFundJwtPayload {
  wallet: string;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AgentFundJwtPayload;
    user: AgentFundJwtPayload;
  }
}

declare module "fastify" {
  interface FastifyRequest {
    /** Populated by middleware/auth.ts's `requireAuth` preHandler after JWT verification. */
    agentWallet?: string;
  }
}
