import "server-only"

import { PrismaPg } from "@prisma/adapter-pg"

import { PrismaClient } from "@/lib/generated/prisma/client"

/**
 * Server-only Prisma client for application reads.
 *
 * Uses the pooled Neon connection (DATABASE_URL). The direct connection
 * (DATABASE_URL_UNPOOLED) is reserved for the Prisma CLI in prisma.config.ts.
 *
 * In development the instance is cached on `globalThis` so Next.js hot module
 * replacement does not open a new pool on every reload. In production each
 * server process creates exactly one client.
 */
function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Add it to .env.local (see `neon env pull`).")
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    // Set PRISMA_QUERY_LOG=1 to print every SQL statement, e.g. to spot N+1 patterns.
    log: process.env.PRISMA_QUERY_LOG === "1" ? ["query"] : [],
    // Better Auth runs each request inside one interactive transaction; give it
    // room for a slow round trip without holding locks for long.
    transactionOptions: { maxWait: 5_000, timeout: 15_000 },
  })
}

const globalForPrisma = globalThis as unknown as { __matchbasePrisma?: PrismaClient }

export const db: PrismaClient = globalForPrisma.__matchbasePrisma ?? createClient()

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__matchbasePrisma = db
}
