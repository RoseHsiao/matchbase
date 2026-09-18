import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { after, before, describe, it } from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"

import { createAuth, type Auth } from "../../lib/auth/create-auth"
import { toViewer } from "../../lib/auth/authorization"
import { PrismaClient } from "../../lib/generated/prisma/client"

/**
 * The real Better Auth instance against the real database: sign-up creates
 * a MatchBase User row with the USER role whatever the browser sends,
 * sign-in yields a session the server resolves to a Viewer, sign-out
 * revokes it, and the demo user cannot sign in. Accounts created here carry
 * a unique test email and are deleted at the end (sessions and accounts
 * cascade). Skipped when no database URL is configured.
 */

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file)
}
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const SECRET = "test-only-secret-0123456789abcdef0123456789"
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const email = (label: string) => `auth-${label}-${stamp}@example.test`
const PASSWORD = "correct horse battery staple"

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

describeDb("Better Auth accounts and sessions (database)", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) })
  let auth: Auth

  before(() => {
    auth = createAuth({ prisma, env: { DATABASE_URL: url, BETTER_AUTH_SECRET: SECRET, NODE_ENV: "test" } })
  })

  after(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${stamp}@example.test` } } })
    await prisma.$disconnect()
  })

  it("sign-up creates a USER even when the request claims to be an ADMIN", async () => {
    const body = { name: "Mallory", email: email("mallory"), password: PASSWORD, role: "ADMIN" } as unknown as { name: string; email: string; password: string }
    const result = await auth.api.signUpEmail({ body })
    assert.equal(result.user.email, email("mallory"))
    const row = await prisma.user.findUniqueOrThrow({ where: { email: email("mallory") }, select: { role: true, emailVerified: true, name: true, accounts: { select: { providerId: true, password: true } } } })
    assert.equal(row.role, "USER")
    assert.equal(row.emailVerified, false)
    assert.equal(row.name, "Mallory")
    assert.equal(row.accounts.length, 1)
    assert.equal(row.accounts[0].providerId, "credential")
    assert.notEqual(row.accounts[0].password, PASSWORD)
    assert.ok((row.accounts[0].password ?? "").length > 40, "password is stored hashed")
    assert.equal(toViewer(result.user).role, "USER")
  })

  it("a duplicate email, a short password and a wrong password are rejected without detail leaks", async () => {
    await auth.api.signUpEmail({ body: { name: "Alice", email: email("alice"), password: PASSWORD } })
    const duplicate = await failure(() => auth.api.signUpEmail({ body: { name: "Alice again", email: email("alice"), password: PASSWORD } }))
    assert.equal(duplicate.body?.code, "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL")
    const short = await failure(() => auth.api.signUpEmail({ body: { name: "Bob", email: email("bob"), password: "short" } }))
    assert.equal(short.body?.code, "PASSWORD_TOO_SHORT")
    const wrong = await failure(() => auth.api.signInEmail({ body: { email: email("alice"), password: "not the password" } }))
    assert.equal(wrong.body?.code, "INVALID_EMAIL_OR_PASSWORD")
    assert.doesNotMatch(wrong.body?.message ?? "", /prisma|postgres|select|stack/i)
    const unknown = await failure(() => auth.api.signInEmail({ body: { email: email("nobody"), password: PASSWORD } }))
    assert.equal(unknown.body?.code, "INVALID_EMAIL_OR_PASSWORD", "unknown email reads the same as a wrong password")
  })

  it("sign-in issues a database session the server resolves to a Viewer; sign-out revokes it", async () => {
    await auth.api.signUpEmail({ body: { name: "Carol", email: email("carol"), password: PASSWORD } })
    // Sign-up auto-signs in (one session); a second device signs in below (a second session).
    const before = await prisma.session.count({ where: { user: { email: email("carol") } } })
    const { headers, response } = await auth.api.signInEmail({ body: { email: email("carol"), password: PASSWORD }, returnHeaders: true })
    const setCookie = headers.get("set-cookie")
    assert.ok(setCookie, "a session cookie is set")
    assert.match(setCookie, /HttpOnly/i)
    assert.match(setCookie, /SameSite=Lax/i)
    assert.equal(response.user.email, email("carol"))

    const stored = await prisma.session.findMany({ where: { user: { email: email("carol") } }, select: { token: true, expiresAt: true }, orderBy: { createdAt: "desc" } })
    assert.equal(stored.length, before + 1)
    assert.ok(stored[0].expiresAt.getTime() - Date.now() > 6 * 24 * 3_600_000, "about seven days")
    assert.ok(stored[0].expiresAt.getTime() - Date.now() <= 7 * 24 * 3_600_000 + 60_000)
    assert.match(setCookie, /better-auth\.session_token=[^;]+\.[^;]+/, "the cookie carries the token with an HMAC signature")

    const cookies = cookieHeader(setCookie)
    const session = await auth.api.getSession({ headers: cookies })
    assert.ok(session)
    const viewer = toViewer(session.user)
    assert.deepEqual(viewer, { id: session.user.id, email: email("carol"), name: "Carol", role: "USER" })

    await auth.api.signOut({ headers: cookies })
    assert.equal(await auth.api.getSession({ headers: cookies }), null, "the revoked cookie no longer resolves")
    assert.equal(await prisma.session.count({ where: { user: { email: email("carol") } } }), before, "only this device's session was revoked")
  })

  it("a role granted by the operator is visible on the next session read, and revoked just as fast", async () => {
    await auth.api.signUpEmail({ body: { name: "Dana", email: email("dana"), password: PASSWORD } })
    const { headers } = await auth.api.signInEmail({ body: { email: email("dana"), password: PASSWORD }, returnHeaders: true })
    const cookies = cookieHeader(headers.get("set-cookie"))
    assert.equal(toViewer((await auth.api.getSession({ headers: cookies }))!.user).role, "USER")
    await prisma.user.update({ where: { email: email("dana") }, data: { role: "ADMIN" } })
    assert.equal(toViewer((await auth.api.getSession({ headers: cookies }))!.user).role, "ADMIN")
    await prisma.user.update({ where: { email: email("dana") }, data: { role: "USER" } })
    assert.equal(toViewer((await auth.api.getSession({ headers: cookies }))!.user).role, "USER")
  })

  it("a user cannot change their own role through the update endpoint", async () => {
    await auth.api.signUpEmail({ body: { name: "Eve", email: email("eve"), password: PASSWORD } })
    const { headers } = await auth.api.signInEmail({ body: { email: email("eve"), password: PASSWORD }, returnHeaders: true })
    const cookies = cookieHeader(headers.get("set-cookie"))
    await auth.api.updateUser({ headers: cookies, body: { name: "Eve Updated", role: "ADMIN" } as unknown as { name: string } }).catch(() => undefined)
    const row = await prisma.user.findUniqueOrThrow({ where: { email: email("eve") }, select: { role: true } })
    assert.equal(row.role, "USER")
  })

  it("the seeded demo user has no credential and cannot sign in", async () => {
    const demo = await prisma.user.findUnique({ where: { id: "demo-user" }, select: { accounts: { select: { id: true } } } })
    if (!demo) return
    assert.equal(demo.accounts.length, 0)
    const attempt = await failure(() => auth.api.signInEmail({ body: { email: "guest@matchbase.app", password: "guest" } }))
    assert.equal(attempt.body?.code, "INVALID_EMAIL_OR_PASSWORD")
  })

  it("sign-up is refused when the deployment closes it", async () => {
    const closed = createAuth({ prisma, env: { DATABASE_URL: url, BETTER_AUTH_SECRET: SECRET, NODE_ENV: "test", AUTH_ALLOW_SIGN_UP: "false" } })
    const refused = await failure(() => closed.api.signUpEmail({ body: { name: "Frank", email: email("frank"), password: PASSWORD } }))
    assert.equal(refused.body?.code, "EMAIL_PASSWORD_SIGN_UP_DISABLED")
    assert.equal(await prisma.user.count({ where: { email: email("frank") } }), 0)
  })
})
