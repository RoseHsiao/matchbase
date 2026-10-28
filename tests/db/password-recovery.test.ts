import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { after, before, describe, it } from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"

import { authPathOf, isBlockedAuthRequest } from "../../lib/auth/blocked-auth-paths"
import { createAuth, RATE_LIMIT_SIGN_UP_PER_HOUR, type Auth } from "../../lib/auth/create-auth"
import { PASSWORD_RESET_TOKEN_TTL_SECONDS } from "../../lib/auth/password-policy"
import { PrismaClient } from "../../lib/generated/prisma/client"
import { createCaptureMailer, type CaptureMailer } from "../../lib/mail/transports/capture"

/**
 * Self-service password recovery through the real Better Auth HTTP handler
 * against the development database, with a capture mailer: nothing leaves
 * the process. Accounts carry a unique test email and are deleted at the
 * end with their sessions, credentials, reset rows and rate-limit rows.
 * Skipped without a database URL.
 */

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file)
}
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const realFetch = globalThis.fetch
globalThis.fetch = (() => {
  throw new Error("A recovery test tried to reach the network.")
}) as typeof fetch

const BASE = "http://localhost:3000"
const SECRET = "test-only-secret-0123456789abcdef0123456789"
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const email = (label: string) => `recovery-${label}-${stamp}@example.test`
const PASSWORD = "correct horse battery staple"
const NEW_PASSWORD = "a different long passphrase"
const RESET_ENV = { AUTH_PASSWORD_RESET_ENABLED: "true" }

let ipCounter = 0
const ipBase = Math.floor(Math.random() * 250)
const usedIps: string[] = []
function nextIp(): string {
  const ip = `198.51.${100 + (Date.now() % 50)}.${(ipBase + ipCounter++) % 250}`
  usedIps.push(ip)
  return ip
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": nextIp(), ...headers },
    body: JSON.stringify(body),
  })
}

async function json(response: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, unknown> }
}

function cookieOf(response: Response): string {
  return (response.headers.get("set-cookie") ?? "")
    .split(/,(?=\s*[^;,]+=)/)
    .map((part) => part.split(";")[0].trim())
    .filter(Boolean)
    .join("; ")
}

function tokenFrom(capture: CaptureMailer): string {
  const message = capture.messages.findLast((m) => m.kind === "password-reset")
  const token = /#token=([A-Za-z0-9_-]+)/.exec(message?.text ?? "")?.[1]
  assert.ok(token, "the reset email carries a fragment token")
  return token
}

describeDb("self-service password recovery (database)", () => {
  // Better Auth wraps some requests in an interactive transaction; allow a distant database some room.
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }), transactionOptions: { timeout: 30_000, maxWait: 10_000 } })
  const capture = createCaptureMailer({})
  const logs: string[] = []
  let auth: Auth
  const userIds: string[] = []

  /** Recovery on, rate limiting off (development), capture mailer. */
  // Production's shape for recovery: sign-up closed (so verification is not required), recovery on.
  const devEnv = { DATABASE_URL: url, BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: BASE, NODE_ENV: "development", AUTH_ALLOW_SIGN_UP: "false", MAIL_TRANSPORT: "dev-outbox", MAIL_FROM: "MatchBase <dev@example.test>", ...RESET_ENV }
  /** Creates accounts the way the operator command does: Better Auth sign-up on an instance without mail. */
  let creator: Auth

  async function createAccount(label: string): Promise<{ id: string; email: string }> {
    const address = email(label)
    await creator.api.signUpEmail({ body: { name: `Recovery ${label}`, email: address, password: PASSWORD } })
    const user = await prisma.user.findUniqueOrThrow({ where: { email: address }, select: { id: true, email: true } })
    userIds.push(user.id)
    return user
  }

  async function signIn(address: string, password: string, instance: Auth = auth): Promise<Response> {
    return instance.handler(post("/sign-in/email", { email: address, password }))
  }

  const originalInfo = console.info
  before(() => {
    console.info = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "))
    }
    auth = createAuth({ prisma, env: devEnv, mailer: capture })
    creator = createAuth({ prisma, env: { DATABASE_URL: url, BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: BASE, NODE_ENV: "development" } })
  })

  after(async () => {
    console.info = originalInfo
    globalThis.fetch = realFetch
    if (userIds.length) await prisma.verification.deleteMany({ where: { value: { in: userIds } } })
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${stamp}@example.test` } } })
    for (const ip of usedIps) await prisma.rateLimit.deleteMany({ where: { key: { startsWith: `${ip}|` } } })
    await prisma.$disconnect()
  })

  it("answers known, unknown and password-less addresses identically, and mails only the known one", async () => {
    const known = await createAccount("known")
    const passwordless = await prisma.user.create({ data: { email: email("passwordless"), name: "No password" }, select: { id: true, email: true } })
    userIds.push(passwordless.id)
    capture.clear()

    const answers = []
    for (const address of [known.email, email("nobody"), passwordless.email]) answers.push(await json(await auth.handler(post("/request-password-reset", { email: address }))))
    assert.deepEqual(answers[1], answers[0], "unknown address gets the same status and body")
    assert.deepEqual(answers[2], answers[0], "an account without a password gets the same status and body")
    assert.equal(answers[0].status, 200)

    assert.deepEqual(capture.messages.map((m) => [m.kind, m.to]), [["password-reset", known.email]])
    assert.equal((await prisma.verification.count({ where: { value: passwordless.id } })), 1, "Better Auth still issued its row; only the mail was withheld")
  })

  it("stores the token hashed, for 30 minutes, and emails the fragment link built from the base URL", async () => {
    const user = await createAccount("stored")
    capture.clear()
    const before = Date.now()
    await auth.handler(post("/request-password-reset", { email: user.email }))
    const token = tokenFrom(capture)
    const message = capture.messages[0]
    assert.ok(message.text.includes(`${BASE}/reset-password#token=${token}`))
    assert.ok(!message.text.includes("/api/auth/reset-password/"), "Better Auth's own link is never mailed")

    const rows = await prisma.verification.findMany({ where: { value: user.id } })
    assert.equal(rows.length, 1)
    assert.ok(!rows[0].identifier.includes(token), "the raw token is not in the database")
    assert.ok(!rows[0].identifier.startsWith("reset-password:"))
    const ttl = (rows[0].expiresAt.getTime() - before) / 1000
    assert.ok(Math.abs(ttl - PASSWORD_RESET_TOKEN_TTL_SECONDS) < 60, `expires in about 30 minutes (got ${Math.round(ttl)} s)`)
  })

  it("a valid reset changes the password, ends every session, sends the notice once and leaves emailVerified alone", async () => {
    const user = await createAccount("valid")
    const signedIn = await signIn(user.email, PASSWORD)
    assert.equal(signedIn.status, 200)
    const cookie = cookieOf(signedIn)
    assert.ok(await auth.api.getSession({ headers: new Headers({ cookie }) }), "session exists before the reset")
    const verifiedBefore = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified

    capture.clear()
    await auth.handler(post("/request-password-reset", { email: user.email }))
    const token = tokenFrom(capture)
    const reset = await json(await auth.handler(post("/reset-password", { token, newPassword: NEW_PASSWORD })))
    assert.deepEqual(reset, { status: 200, body: { status: true } })

    assert.equal(await auth.api.getSession({ headers: new Headers({ cookie }) }), null, "the old session is revoked")
    assert.equal(await prisma.session.count({ where: { userId: user.id } }), 0)
    assert.equal((await signIn(user.email, PASSWORD)).status, 401, "old password no longer works")
    assert.equal((await signIn(user.email, NEW_PASSWORD)).status, 200, "new password works")

    assert.deepEqual(capture.messages.map((m) => m.kind), ["password-reset", "password-changed"])
    const notice = capture.messages[1]
    assert.equal(notice.to, user.email)
    assert.ok(!notice.text.includes(token) && !/https?:\/\//.test(notice.text), "the notice carries no link or token")
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified, verifiedBefore, "emailVerified unchanged")
    assert.equal(verifiedBefore, false)
  })

  it("a consumed token cannot be replayed", async () => {
    const user = await createAccount("replay")
    capture.clear()
    await auth.handler(post("/request-password-reset", { email: user.email }))
    const token = tokenFrom(capture)
    assert.equal((await auth.handler(post("/reset-password", { token, newPassword: NEW_PASSWORD }))).status, 200)
    capture.clear()
    const replay = await json(await auth.handler(post("/reset-password", { token, newPassword: "yet another passphrase" })))
    assert.equal(replay.status, 400)
    assert.equal(replay.body.code, "INVALID_TOKEN")
    assert.equal(capture.messages.length, 0, "no second notice")
    assert.equal((await signIn(user.email, NEW_PASSWORD)).status, 200, "the replay changed nothing")
  })

  it("an expired token is rejected", async () => {
    const user = await createAccount("expired")
    capture.clear()
    await auth.handler(post("/request-password-reset", { email: user.email }))
    const token = tokenFrom(capture)
    await prisma.verification.updateMany({ where: { value: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const answer = await json(await auth.handler(post("/reset-password", { token, newPassword: NEW_PASSWORD })))
    assert.equal(answer.status, 400)
    assert.equal(answer.body.code, "INVALID_TOKEN")
    assert.equal((await signIn(user.email, PASSWORD)).status, 200, "password unchanged")
    assert.equal(capture.messages.filter((m) => m.kind === "password-changed").length, 0)
  })

  it("a successful reset invalidates the user's other outstanding links", async () => {
    const user = await createAccount("siblings")
    capture.clear()
    await auth.handler(post("/request-password-reset", { email: user.email }))
    const first = tokenFrom(capture)
    await auth.handler(post("/request-password-reset", { email: user.email }))
    const second = tokenFrom(capture)
    assert.notEqual(first, second)
    assert.equal((await auth.handler(post("/reset-password", { token: second, newPassword: NEW_PASSWORD }))).status, 200)
    assert.equal((await auth.handler(post("/reset-password", { token: first, newPassword: "yet another passphrase" }))).status, 400)
    assert.equal(await prisma.verification.count({ where: { value: user.id } }), 0)
  })

  it("a mail failure still answers generically and logs only the outcome", async () => {
    const user = await createAccount("mailfail")
    capture.clear()
    logs.length = 0
    capture.respondWith({ status: "failed", transport: "capture", category: "provider-5xx", retryable: true })
    try {
      const answer = await json(await auth.handler(post("/request-password-reset", { email: user.email })))
      const unknown = await json(await auth.handler(post("/request-password-reset", { email: email("nobody-2") })))
      assert.deepEqual(answer, unknown)
    } finally {
      capture.respondWith({ status: "sent", transport: "capture" })
    }
    const mailLines = logs.filter((line) => line.startsWith("[mail]"))
    assert.deepEqual(mailLines, ["[mail] kind=password-reset transport=capture status=failed category=provider-5xx retryable=true"])
    for (const line of logs) assert.ok(!line.includes(user.email) && !line.includes("#token="), line)
  })

  it("the password-changed notice is sent only by the self-service reset, never by a signed-in password change", async () => {
    const user = await createAccount("change")
    const cookie = cookieOf(await signIn(user.email, PASSWORD))
    capture.clear()
    const changed = await auth.handler(
      new Request(`${BASE}/api/auth/change-password`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE, cookie, "x-forwarded-for": nextIp() },
        body: JSON.stringify({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }),
      })
    )
    assert.equal(changed.status, 200)
    assert.equal(capture.messages.length, 0, "generic password changes send nothing")
  })

  it("with recovery disabled, every address gets the same refusal and nothing is mailed", async () => {
    const user = await createAccount("disabled")
    const disabledCapture = createCaptureMailer({})
    const disabled = createAuth({ prisma, env: { DATABASE_URL: url, BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: BASE, NODE_ENV: "development" }, mailer: disabledCapture })
    const flagWithoutTransport = createAuth({ prisma, env: { DATABASE_URL: url, BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: BASE, NODE_ENV: "development", ...RESET_ENV }, mailer: disabledCapture })
    for (const instance of [disabled, flagWithoutTransport]) {
      const known = await json(await instance.handler(post("/request-password-reset", { email: user.email })))
      const unknown = await json(await instance.handler(post("/request-password-reset", { email: email("nobody-3") })))
      assert.deepEqual(known, unknown)
      assert.equal(known.status, 400)
      assert.equal(known.body.code, "RESET_PASSWORD_DISABLED")
    }
    assert.equal(disabledCapture.messages.length, 0)
    assert.equal(await prisma.verification.count({ where: { value: user.id } }), 0, "no token was issued")
  })

  it("keeps the existing per-IP limit on reset requests", async () => {
    const user = await createAccount("limited")
    const limited = createAuth({
      prisma,
      env: { DATABASE_URL: url, BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: BASE, NODE_ENV: "production", MAIL_TRANSPORT: "resend", MAIL_FROM: "noreply@mail.example.test", RESEND_API_KEY: "re_TestKey_0123456789abcdef", ...RESET_ENV },
      mailer: capture,
    })
    const ip = nextIp()
    const statuses: number[] = []
    for (let i = 0; i < RATE_LIMIT_SIGN_UP_PER_HOUR + 1; i++) {
      statuses.push((await limited.handler(post("/request-password-reset", { email: user.email }, { "x-forwarded-for": ip }))).status)
    }
    assert.deepEqual(statuses, [...Array(RATE_LIMIT_SIGN_UP_PER_HOUR).fill(200), 429])
    const rows = await prisma.rateLimit.findMany({ where: { key: { startsWith: `${ip}|` } } })
    assert.deepEqual(rows.map((row) => row.key), [`${ip}|/request-password-reset`], "counted per client IP, not in a shared bucket")
  })

  it("Better Auth's GET reset link is refused at the route boundary", () => {
    assert.equal(isBlockedAuthRequest("GET", authPathOf(`${BASE}/api/auth/reset-password/abcDEF123456`) ?? ""), true)
    assert.equal(isBlockedAuthRequest("GET", authPathOf(`${BASE}/api/auth/reset-password/abcDEF123456?callbackURL=/x`) ?? ""), true)
    assert.equal(isBlockedAuthRequest("POST", "/reset-password"), false, "the POST that consumes the token stays open")
    assert.equal(isBlockedAuthRequest("GET", "/get-session"), false)
    assert.equal(authPathOf(`${BASE}/reset-password`), null, "the page itself is not an auth path")
  })
})
