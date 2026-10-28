import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { after, before, describe, it } from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"
import { signJWT } from "better-auth/crypto"

import { authPathOf, isBlockedAuthRequest } from "../../lib/auth/blocked-auth-paths"
import { createAuth, type Auth } from "../../lib/auth/create-auth"
import { verifyEmailToken } from "../../lib/auth/email-verification"
import { PrismaClient } from "../../lib/generated/prisma/client"
import { createCaptureMailer, type CaptureMailer } from "../../lib/mail/transports/capture"

/**
 * Email verification on Better Auth's token lifecycle, through the real
 * handler and MatchBase's POST bridge, against the development database with
 * a capture mailer (global fetch replaced: nothing leaves the process).
 * Accounts use a unique test email and are deleted at the end.
 */

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file)
}
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const realFetch = globalThis.fetch
globalThis.fetch = (() => {
  throw new Error("A verification test tried to reach the network.")
}) as typeof fetch

const BASE = "http://localhost:3000"
const SECRET = "test-only-secret-0123456789abcdef0123456789"
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const email = (label: string) => `verify-${label}-${stamp}@example.test`
const PASSWORD = "correct horse battery staple"
const MAIL = { MAIL_TRANSPORT: "dev-outbox", MAIL_FROM: "MatchBase <dev@example.test>" }
const baseEnv = { DATABASE_URL: url, BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: BASE, NODE_ENV: "development" }

function post(path: string, body: unknown, extra: Record<string, string> = {}): Request {
  return new Request(`${BASE}/api/auth${path}`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, ...extra }, body: JSON.stringify(body) })
}

function cookieOf(response: Response): string {
  return (response.headers.get("set-cookie") ?? "")
    .split(/,(?=\s*[^;,]+=)/)
    .map((part) => part.split(";")[0].trim())
    .filter(Boolean)
    .join("; ")
}

function lastToken(capture: CaptureMailer): string {
  const message = capture.messages.findLast((m) => m.kind === "email-verification")
  const token = /\/verify-email#token=([A-Za-z0-9_.-]+)/.exec(message?.text ?? "")?.[1]
  assert.ok(token, "the verification email carries a fragment link")
  return token
}

describeDb("email verification (database)", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }), transactionOptions: { timeout: 30_000, maxWait: 10_000 } })
  const capture = createCaptureMailer({})
  const logs: string[] = []
  const originals = { info: console.info, warn: console.warn, error: console.error }
  /** Sign-up open with deliverable mail: verification required. */
  let open: Auth

  const verify = (instance: Auth, token: unknown) => verifyEmailToken(post("/verify-email", { token }), (request) => instance.handler(request))
  const sessionsOf = async (address: string) => prisma.session.count({ where: { user: { email: address } } })

  before(() => {
    for (const level of ["info", "warn", "error"] as const) console[level] = (...args: unknown[]) => void logs.push(args.map(String).join(" "))
    open = createAuth({ prisma, env: { ...baseEnv, ...MAIL }, mailer: capture })
  })

  after(async () => {
    Object.assign(console, originals)
    globalThis.fetch = realFetch
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${stamp}@example.test` } } })
    await prisma.$disconnect()
  })

  it("open sign-up requires verification: no session, one verification email with the fragment link", async () => {
    capture.clear()
    const address = email("signup")
    const response = await open.handler(post("/sign-up/email", { name: "New Person", email: address, password: PASSWORD }))
    assert.equal(response.status, 200)
    const body = (await response.json()) as { token: string | null }
    assert.equal(body.token, null, "no session token")
    assert.equal(cookieOf(response).includes("session_token"), false, "no session cookie")
    assert.equal(await sessionsOf(address), 0)
    assert.deepEqual(capture.messages.map((m) => [m.kind, m.to]), [["email-verification", address]])
    const text = capture.messages[0].text
    assert.ok(text.includes(`${BASE}/verify-email#token=`))
    assert.ok(!text.includes("/api/auth/verify-email?token="), "Better Auth's GET link is never mailed")
    assert.ok(!capture.messages[0].subject.includes(address))
  })

  it("a duplicate sign-up is answered like a new one and logs no address", async () => {
    const address = email("signup")
    capture.clear()
    logs.length = 0
    const duplicate = await open.handler(post("/sign-up/email", { name: "Someone Else", email: address, password: "another long passphrase" }))
    const fresh = await open.handler(post("/sign-up/email", { name: "Fresh", email: email("fresh"), password: PASSWORD }))
    assert.equal(duplicate.status, fresh.status)
    const [a, b] = [(await duplicate.json()) as Record<string, unknown>, (await fresh.json()) as Record<string, unknown>]
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort())
    assert.equal(a.token, null)
    assert.deepEqual(capture.messages.map((m) => m.to), [email("fresh")], "the existing owner is not mailed")
    for (const line of logs) assert.ok(!line.includes("@example.test"), line)
  })

  it("an unconfirmed account cannot sign in; the correct password triggers a new link, a wrong one does not", async () => {
    const address = email("signup")
    capture.clear()
    const wrong = await open.handler(post("/sign-in/email", { email: address, password: "not the password at all" }))
    assert.equal(wrong.status, 401)
    assert.equal(capture.messages.length, 0)
    const right = await open.handler(post("/sign-in/email", { email: address, password: PASSWORD }))
    assert.equal(right.status, 403)
    assert.equal(((await right.json()) as { code?: string }).code, "EMAIL_NOT_VERIFIED")
    assert.equal(capture.messages.length, 1)
    assert.equal(await sessionsOf(address), 0)
  })

  it("a valid token confirms the address once, creates no session, and a replay is refused", async () => {
    const address = email("signup")
    const token = lastToken(capture)
    assert.deepEqual(await verify(open, token), { status: 200, body: { status: "verified" } })
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { email: address } })).emailVerified, true)
    assert.equal(await sessionsOf(address), 0, "verification never signs anyone in")
    assert.deepEqual(await verify(open, token), { status: 400, body: { code: "TOKEN_ALREADY_USED" } })
    assert.equal(await sessionsOf(address), 0, "nor does a replay")
    assert.equal((await open.handler(post("/sign-in/email", { email: address, password: PASSWORD }))).status, 200, "now the account signs in")
  })

  it("an expired token is refused and changes nothing", async () => {
    const address = email("expired")
    await open.handler(post("/sign-up/email", { name: "Late", email: address, password: PASSWORD }))
    const expired = await signJWT({ email: address }, SECRET, -60)
    assert.deepEqual(await verify(open, expired), { status: 400, body: { code: "TOKEN_EXPIRED" } })
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { email: address } })).emailVerified, false)
  })

  it("invalid tokens are refused: malformed, foreign signature, unknown account", async () => {
    const forged = await signJWT({ email: email("expired") }, "a-different-secret-0123456789abcdef0123", 600)
    const unknown = await signJWT({ email: email("nobody") }, SECRET, 600)
    for (const token of [undefined, "", "not-a-jwt", 42, "a.b", forged, unknown]) {
      assert.deepEqual(await verify(open, token), { status: 400, body: { code: "INVALID_TOKEN" } }, String(token).slice(0, 20))
    }
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { email: email("expired") } })).emailVerified, false)
  })

  it("unauthenticated resend answers alike for unknown, unconfirmed and confirmed addresses", async () => {
    capture.clear()
    const answers = []
    for (const address of [email("nobody"), email("expired"), email("signup")]) {
      const response = await open.handler(post("/send-verification-email", { email: address }))
      answers.push([response.status, await response.json()])
    }
    assert.deepEqual(answers[1], answers[0])
    assert.deepEqual(answers[2], answers[0])
    assert.deepEqual(capture.messages.map((m) => m.to), [email("expired")], "only the unconfirmed account is mailed")
  })

  it("with sign-up closed (today's Production shape) an unconfirmed operator account still signs in and may confirm on request", async () => {
    const closedCapture = createCaptureMailer({})
    const closed = createAuth({ prisma, env: { ...baseEnv, ...MAIL, AUTH_ALLOW_SIGN_UP: "false" }, mailer: closedCapture })
    const creator = createAuth({ prisma, env: baseEnv })
    const address = email("operator")
    await creator.api.signUpEmail({ body: { name: "Operator Admin", email: address, password: PASSWORD } })
    await prisma.user.update({ where: { email: address }, data: { role: "ADMIN" } })

    assert.equal((await closed.handler(post("/sign-up/email", { name: "X", email: email("refused"), password: PASSWORD }))).status, 400, "sign-up closed")
    const signedIn = await closed.handler(post("/sign-in/email", { email: address, password: PASSWORD }))
    assert.equal(signedIn.status, 200, "no lockout: verification is not required while sign-up is closed")
    const resend = await closed.handler(post("/send-verification-email", { email: address }, { cookie: cookieOf(signedIn) }))
    assert.equal(resend.status, 200)
    assert.equal(closedCapture.messages.length, 1)
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { email: address } })).emailVerified, false, "requesting a link does not confirm")
    assert.deepEqual(await verify(closed, lastToken(closedCapture)), { status: 200, body: { status: "verified" } })
  })

  it("without a deliverable transport: no verification mail, and sign-up is refused outside development", async () => {
    const noMail = createAuth({ prisma, env: { ...baseEnv, AUTH_ALLOW_SIGN_UP: "false" } })
    const answer = await noMail.handler(post("/send-verification-email", { email: email("operator") }))
    assert.equal(answer.status, 400)
    assert.equal(((await answer.json()) as { code?: string }).code, "VERIFICATION_EMAIL_NOT_ENABLED")

    const productionNoMail = createAuth({ prisma, env: { DATABASE_URL: url, BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: BASE, NODE_ENV: "production", AUTH_ALLOW_SIGN_UP: "true" } })
    const refused = await productionNoMail.handler(post("/sign-up/email", { name: "X", email: email("prod-refused"), password: PASSWORD }, { "x-forwarded-for": "192.0.2.77" }))
    assert.equal(refused.status, 400, "AUTH_ALLOW_SIGN_UP=true alone does not open sign-up without mail")
    assert.equal(await prisma.user.count({ where: { email: email("prod-refused") } }), 0)
    await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "192.0.2.77|" } } })
  })

  it("Better Auth's GET verification endpoint is refused at the route boundary", () => {
    assert.equal(isBlockedAuthRequest("GET", authPathOf(`${BASE}/api/auth/verify-email?token=a.b.c`) ?? ""), true)
    assert.equal(isBlockedAuthRequest("POST", "/verify-email"), false)
  })
})
