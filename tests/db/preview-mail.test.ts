import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { after, before, describe, it } from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"

import { createAuth, type Auth } from "../../lib/auth/create-auth"
import { PrismaClient } from "../../lib/generated/prisma/client"
import { RESEND_ENDPOINT } from "../../lib/mail/transports/resend"

/**
 * The Preview configuration end to end, without a network: a Preview-shaped
 * environment with MAIL_TRANSPORT=resend and an exact allowlist, the real
 * auth handler, the real createMailer and the real Resend transport. Only
 * the global `fetch` is replaced, by a recorder that answers like Resend.
 * Proves that the allowlist is applied before any outbound request and
 * that logs carry no recipient, link, token or body. Rate limiting is on
 * (Preview), so every request uses its own documentation-range IP.
 */

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file)
}
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const HOST = "matchbase-git-preview-test.vercel.app"
const BASE = `https://${HOST}`
const SECRET = "test-only-secret-0123456789abcdef0123456789"
const KEY = "re_PreviewTestKey_0123456789abcdef"
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const email = (label: string) => `preview-${label}-${stamp}@example.test`
const PASSWORD = "correct horse battery staple"

type Outbound = { url: string; headers: Record<string, string>; body: string }
const outbound: Outbound[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const target = String(input instanceof Request ? input.url : input)
  if (target !== RESEND_ENDPOINT) throw new Error(`Unexpected outbound request to ${target}`)
  outbound.push({ url: target, headers: (init?.headers ?? {}) as Record<string, string>, body: String(init?.body ?? "") })
  return Response.json({ id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" })
}) as typeof fetch

let ip = Math.floor(Math.random() * 200)
const usedIps: string[] = []
function post(path: string, body: unknown): Request {
  const clientIp = `192.0.2.${(ip++ % 250) + 1}`
  usedIps.push(clientIp)
  return new Request(`${BASE}/api/auth${path}`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": clientIp }, body: JSON.stringify(body) })
}

describeDb("Preview mail through Resend with an allowlist (no network)", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }), transactionOptions: { timeout: 30_000, maxWait: 10_000 } })
  const allowed = email("allowed")
  const blocked = email("blocked")
  const logs: string[] = []
  const originalInfo = console.info
  let preview: Auth

  before(async () => {
    // Accounts are created through a development instance (sign-up is closed on Preview).
    const dev = createAuth({ prisma, env: { DATABASE_URL: url, BETTER_AUTH_SECRET: SECRET, NODE_ENV: "development" } })
    for (const address of [allowed, blocked]) await dev.api.signUpEmail({ body: { name: "Preview Check", email: address, password: PASSWORD } })
    preview = createAuth({
      prisma,
      env: {
        DATABASE_URL: url,
        BETTER_AUTH_SECRET: SECRET,
        VERCEL: "1",
        VERCEL_ENV: "preview",
        VERCEL_URL: HOST,
        MAIL_TRANSPORT: "resend",
        MAIL_FROM: "MatchBase <noreply@mail.matchbase.example>",
        RESEND_API_KEY: KEY,
        MAIL_ALLOWED_RECIPIENTS: allowed.toUpperCase(),
        AUTH_PASSWORD_RESET_ENABLED: "true",
      },
    })
    console.info = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "))
    }
  })

  after(async () => {
    console.info = originalInfo
    globalThis.fetch = realFetch
    const users = await prisma.user.findMany({ where: { email: { endsWith: `-${stamp}@example.test` } }, select: { id: true } })
    await prisma.verification.deleteMany({ where: { value: { in: users.map((u) => u.id) } } })
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${stamp}@example.test` } } })
    for (const clientIp of usedIps) await prisma.rateLimit.deleteMany({ where: { key: { startsWith: `${clientIp}|` } } })
    await prisma.$disconnect()
  })

  it("a non-allowlisted account is suppressed before any request, and answered like everyone else", async () => {
    outbound.length = 0
    logs.length = 0
    const blockedAnswer = await preview.handler(post("/request-password-reset", { email: blocked }))
    const unknownAnswer = await preview.handler(post("/request-password-reset", { email: email("nobody") }))
    assert.equal(blockedAnswer.status, 200)
    assert.deepEqual(await blockedAnswer.json(), await unknownAnswer.json())
    assert.equal(outbound.length, 0, "no network request for a suppressed recipient")
    assert.deepEqual(logs.filter((l) => l.startsWith("[mail]")), ["[mail] kind=password-reset transport=resend status=suppressed reason=recipient-not-allowlisted"])
    for (const line of logs) assert.ok(!line.includes(blocked), "the suppressed address is never logged")
  })

  it("an allowlisted account gets exactly one Resend request with the fragment link, and logs only the outcome", async () => {
    outbound.length = 0
    logs.length = 0
    assert.equal((await preview.handler(post("/request-password-reset", { email: allowed }))).status, 200)
    assert.equal(outbound.length, 1)
    const [request] = outbound
    assert.equal(request.headers.authorization, `Bearer ${KEY}`)
    const body = JSON.parse(request.body)
    assert.deepEqual(body.to, [allowed])
    assert.equal(body.from, "MatchBase <noreply@mail.matchbase.example>")
    const token = /#token=([A-Za-z0-9_-]+)/.exec(body.text)?.[1] ?? ""
    assert.ok(token, "the plain-text body carries the fragment link")
    assert.ok(body.text.includes(`${BASE}/reset-password#token=${token}`), "built from the Preview base URL")
    assert.ok(!body.subject.includes(token) && !body.subject.includes(allowed))
    assert.deepEqual(logs.filter((l) => l.startsWith("[mail]")), ["[mail] kind=password-reset transport=resend status=sent id=4ef9a417-02e9-4d39-ad75-9611e0fcc33c"])
    for (const line of logs) assert.ok(!line.includes(allowed) && !line.includes(token) && !line.includes(KEY) && !line.includes("Reset your MatchBase password"), line)
  })
})
