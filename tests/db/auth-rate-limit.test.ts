import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { after, before, describe, it } from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"

import { createAuth, RATE_LIMIT_SIGN_IN_PER_MINUTE, type Auth } from "../../lib/auth/create-auth"
import { PrismaClient } from "../../lib/generated/prisma/client"

/**
 * Database-backed rate limiting through the real HTTP handler, with a
 * Production-shaped configuration against the development database. Each
 * case uses its own client IP so runs never interfere, and the rows it
 * writes are removed afterwards. Skipped without a database URL.
 */

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file)
}
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const stamp = `${Date.now()}`
const BASE = "http://localhost:3000"

function signInRequest(clientIp: string, email: string): Request {
  return new Request(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": clientIp },
    body: JSON.stringify({ email, password: "definitely-not-the-password" }),
  })
}

describeDb("auth rate limiting (database storage)", () => {
  // Better Auth wraps a request in one interactive transaction; from a distant region each round trip is slow, so allow more than Prisma's 5 s default.
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }), transactionOptions: { timeout: 30_000, maxWait: 10_000 } })
  let auth: Auth
  const used: string[] = []

  before(() => {
    // Production-shaped: rate limiting on, database storage, explicit base URL.
    auth = createAuth({ prisma, env: { DATABASE_URL: url, BETTER_AUTH_SECRET: "test-only-secret-0123456789abcdef0123456789", NODE_ENV: "production", BETTER_AUTH_URL: BASE } })
  })

  after(async () => {
    for (const clientIp of used) await prisma.rateLimit.deleteMany({ where: { key: { startsWith: `${clientIp}|` } } })
    await prisma.$disconnect()
  })

  it("allows the sign-in limit per minute and answers 429 with Retry-After beyond it", async () => {
    const clientIp = `203.0.113.${10 + (Number(stamp) % 50)}`
    used.push(clientIp)
    const email = `rate-limit-${stamp}@example.test`
    const statuses: number[] = []
    for (let i = 0; i < RATE_LIMIT_SIGN_IN_PER_MINUTE + 2; i++) {
      const response = await auth.handler(signInRequest(clientIp, email))
      statuses.push(response.status)
      if (response.status === 429) {
        assert.ok(Number(response.headers.get("x-retry-after") ?? response.headers.get("retry-after")) > 0, "retry-after header present")
        break
      }
    }
    assert.deepEqual(statuses.slice(0, RATE_LIMIT_SIGN_IN_PER_MINUTE), Array(RATE_LIMIT_SIGN_IN_PER_MINUTE).fill(401), "wrong passwords are 401 until the limit")
    assert.equal(statuses[RATE_LIMIT_SIGN_IN_PER_MINUTE], 429, "the next attempt is rate limited")
    const rows = await prisma.rateLimit.findMany({ where: { key: { startsWith: `${clientIp}|` } } })
    assert.equal(rows.length, 1, "one shared row per ip and path")
    assert.equal(rows[0].key, `${clientIp}|/sign-in/email`)
    assert.ok(rows[0].count >= RATE_LIMIT_SIGN_IN_PER_MINUTE)
  })

  it("a different client IP has its own window", async () => {
    const clientIp = `203.0.113.${100 + (Number(stamp) % 50)}`
    used.push(clientIp)
    const response = await auth.handler(signInRequest(clientIp, `rate-limit-b-${stamp}@example.test`))
    assert.equal(response.status, 401)
  })

  it("server-side API calls are not rate limited (dev quick sign-in, tests)", async () => {
    await assert.rejects(
      () => auth.api.signInEmail({ body: { email: `nobody-${stamp}@example.test`, password: "definitely-not-the-password" } }),
      (error: { status?: number | string; statusCode?: number }) => error.statusCode === 401 || error.status === 401 || error.status === "UNAUTHORIZED"
    )
  })
})
