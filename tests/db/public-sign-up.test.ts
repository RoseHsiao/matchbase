import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { after, before, describe, it } from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"

import { toViewer } from "../../lib/auth/authorization"
import { CLIENT_IP_HEADER, withTrustedClientIp } from "../../lib/auth/client-ip"
import { createAuth, RATE_LIMIT_SIGN_UP_PER_HOUR, type Auth } from "../../lib/auth/create-auth"
import { PrismaClient } from "../../lib/generated/prisma/client"

/**
 * Public sign-up WITHOUT email verification, configured as a deployment would
 * be (VERCEL_ENV=preview, AUTH_ALLOW_SIGN_UP=true and
 * AUTH_ALLOW_UNVERIFIED_SIGN_UP=true, rate limiter on), against the
 * DEVELOPMENT database. Accounts carry `pub-signup-…-<stamp>@example.test`
 * and rate-limit rows a fresh documentation IP; exactly those are removed
 * afterwards. Skipped without a database URL; refused unless the local
 * configuration labels the database `development`.
 */

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file)
}
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const SECRET = "test-only-secret-0123456789abcdef0123456789"
const BASE = "http://localhost:3000"
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const email = (label: string) => `pub-signup-${label}-${stamp}@example.test`
const PASSWORD = "correct horse battery staple"
const DEPLOYMENT = { DATABASE_URL: url, BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: BASE, VERCEL_ENV: "preview", AUTH_ALLOW_SIGN_UP: "true", AUTH_ALLOW_UNVERIFIED_SIGN_UP: "true" }

type ApiFailure = { status?: number; statusCode?: number; body?: { code?: string; message?: string } }

async function failure(work: () => Promise<unknown>): Promise<ApiFailure> {
  try {
    await work()
  } catch (error) {
    return error as ApiFailure
  }
  throw new Error("expected the call to fail")
}

function cookieHeader(setCookie: string | null): Headers {
  const cookie = (setCookie ?? "")
    .split(/,(?=\s*[^;,]+=)/)
    .map((part) => part.split(";")[0].trim())
    .filter(Boolean)
    .join("; ")
  return new Headers({ cookie })
}

describeDb("public sign-up without verification, deployment configuration (development database)", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }), transactionOptions: { timeout: 30_000, maxWait: 10_000 } })
  let auth: Auth
  const usedIps: string[] = []

  before(() => {
    assert.equal(process.env.MATCHBASE_DATABASE_LABEL?.trim().toLowerCase(), "development", "these tests write accounts; they run only against the development database")
    auth = createAuth({ prisma, env: DEPLOYMENT })
  })

  after(async () => {
    await prisma.user.deleteMany({ where: { AND: [{ email: { startsWith: "pub-signup-" } }, { email: { endsWith: `-${stamp}@example.test` } }] } })
    for (const ip of usedIps) await prisma.rateLimit.deleteMany({ where: { key: { startsWith: `${ip}|` } } })
    await prisma.$disconnect()
  })

  it("sign-up opens, signs the account in at once, and stores a USER with an unverified address", async () => {
    const { headers, response } = await auth.api.signUpEmail({ body: { name: "Ada", email: email("ada"), password: PASSWORD }, returnHeaders: true })
    assert.ok(response.token, "auto sign-in returns a session token")
    assert.match(headers.get("set-cookie") ?? "", /better-auth\.session_token=/)
    const session = await auth.api.getSession({ headers: cookieHeader(headers.get("set-cookie")) })
    assert.equal(toViewer(session!.user).role, "USER")
    const row = await prisma.user.findUniqueOrThrow({ where: { email: email("ada") }, select: { role: true, emailVerified: true } })
    assert.deepEqual(row, { role: "USER", emailVerified: false })
  })

  it("the sign-up payload cannot set role, emailVerified, id, timestamps or a session for someone else", async () => {
    const body = { name: "Mallory", email: email("mallory"), password: PASSWORD, role: "ADMIN", emailVerified: true, id: `pub-signup-chosen-${stamp}`, createdAt: "2000-01-01T00:00:00.000Z", updatedAt: "2000-01-01T00:00:00.000Z", banned: false, userId: "someone-else" }
    const result = await auth.api.signUpEmail({ body: body as unknown as { name: string; email: string; password: string } })
    const row = await prisma.user.findUniqueOrThrow({ where: { email: email("mallory") }, select: { id: true, role: true, emailVerified: true, createdAt: true } })
    assert.equal(row.role, "USER")
    assert.equal(row.emailVerified, false)
    assert.notEqual(row.id, body.id)
    assert.ok(row.createdAt.getUTCFullYear() >= 2026)
    assert.equal(result.user.id, row.id)
  })

  it("update-user refuses role, drops emailVerified, and cannot change the address", async () => {
    await auth.api.signUpEmail({ body: { name: "Eve", email: email("eve"), password: PASSWORD } })
    const { headers } = await auth.api.signInEmail({ body: { email: email("eve"), password: PASSWORD }, returnHeaders: true })
    const cookies = cookieHeader(headers.get("set-cookie"))
    const role = await failure(() => auth.api.updateUser({ headers: cookies, body: { role: "ADMIN" } as unknown as { name: string } }))
    assert.equal(role.body?.code, "FIELD_NOT_ALLOWED")
    await auth.api.updateUser({ headers: cookies, body: { name: "Eve Renamed", emailVerified: true } as unknown as { name: string } })
    const changeEmail = await failure(() => auth.api.updateUser({ headers: cookies, body: { email: email("other") } as unknown as { name: string } }))
    assert.equal(changeEmail.body?.code, "EMAIL_CAN_NOT_BE_UPDATED")
    const row = await prisma.user.findUniqueOrThrow({ where: { email: email("eve") }, select: { role: true, emailVerified: true, name: true } })
    assert.deepEqual(row, { role: "USER", emailVerified: false, name: "Eve Renamed" })
  })

  it("enumeration: an existing address answers 422 USER_ALREADY_EXISTS, a new one 200 (known, documented limit)", async (t) => {
    await auth.api.signUpEmail({ body: { name: "Kim", email: email("kim"), password: PASSWORD } })
    const timings = { existing: [] as number[], fresh: [] as number[] }
    for (let i = 0; i < 3; i++) {
      let started = performance.now()
      const existing = await auth.api.signUpEmail({ body: { name: "Kim", email: email("kim"), password: PASSWORD }, asResponse: true })
      timings.existing.push(performance.now() - started)
      assert.equal(existing.status, 422)
      assert.equal(((await existing.json()) as { code?: string }).code, "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL")
      assert.equal(existing.headers.get("set-cookie"), null)
      started = performance.now()
      const fresh = await auth.api.signUpEmail({ body: { name: "New", email: email(`fresh${i}`), password: PASSWORD }, asResponse: true })
      timings.fresh.push(performance.now() - started)
      assert.equal(fresh.status, 200)
    }
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[1]
    t.diagnostic(`median sign-up time: existing address ${median(timings.existing).toFixed(0)} ms, new address ${median(timings.fresh).toFixed(0)} ms`)
  })

  it(`the HTTP endpoint keeps the per-IP limit: ${RATE_LIMIT_SIGN_UP_PER_HOUR} an hour, then 429`, async () => {
    let ip = ""
    for (let attempt = 0; attempt < 20 && !ip; attempt++) {
      const candidate = `198.51.100.${1 + Math.floor(Math.random() * 254)}`
      if ((await prisma.rateLimit.count({ where: { key: { startsWith: `${candidate}|` } } })) === 0) ip = candidate
    }
    assert.ok(ip, "a documentation IP with no rate-limit row")
    usedIps.push(ip)
    const statuses: number[] = []
    for (let i = 0; i < RATE_LIMIT_SIGN_UP_PER_HOUR + 1; i++) {
      // A too-short password: the limiter counts the request, and no account is created.
      // Through the route's boundary as on Vercel, with a client-forged left part and a forged private header:
      // only the rightmost forwarded entry (the platform's) counts, so the limit stays per client.
      const response = await auth.handler(withTrustedClientIp(new Request(`${BASE}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `203.0.113.${i + 1}, ${ip}`, [CLIENT_IP_HEADER]: `192.0.2.${i + 1}` },
        body: JSON.stringify({ name: "Probe", email: email(`probe${i}`), password: "short" }),
      }), { VERCEL: "1" }))
      statuses.push(response.status)
    }
    assert.deepEqual(statuses, [...Array(RATE_LIMIT_SIGN_UP_PER_HOUR).fill(400), 429])
    const keys = await prisma.rateLimit.findMany({ where: { key: { startsWith: `${ip}|` } }, select: { key: true } })
    assert.deepEqual(keys.map((row) => row.key), [`${ip}|/sign-up/email`], "keyed on the platform-observed address, not a forged one or a shared bucket")
    assert.equal(await prisma.user.count({ where: { email: { startsWith: "pub-signup-probe", endsWith: `-${stamp}@example.test` } } }), 0)
  })

  it("either flag alone keeps sign-up closed on a deployment", async () => {
    for (const half of [{ AUTH_ALLOW_UNVERIFIED_SIGN_UP: undefined }, { AUTH_ALLOW_SIGN_UP: undefined }]) {
      const closed = createAuth({ prisma, env: { ...DEPLOYMENT, ...half } })
      const refused = await failure(() => closed.api.signUpEmail({ body: { name: "Half", email: email("half"), password: PASSWORD } }))
      assert.equal(refused.body?.code, "EMAIL_PASSWORD_SIGN_UP_DISABLED", JSON.stringify(half))
    }
    assert.equal(await prisma.user.count({ where: { email: email("half") } }), 0)
  })
})
