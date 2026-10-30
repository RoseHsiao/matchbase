import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { after, before, describe, it } from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"

import { createAuth, type Auth } from "../../lib/auth/create-auth"
import { PrismaClient } from "../../lib/generated/prisma/client"
import { createCaptureMailer } from "../../lib/mail/transports/capture"

/**
 * The operator password reset (scripts/account-password.mts) and the operator
 * guards shared by every operator command. The reset is exercised end to end:
 * a real account, the script with the new password in its environment, then a
 * sign-in through Better Auth with the new password and a refusal of the old
 * one. Nothing is printed by the script except a status line.
 */

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file)
}
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

function runScript(script: string, args: string[], env: Record<string, string | undefined>) {
  const result = spawnSync("npx", ["tsx", script, ...args], { encoding: "utf8", env: { ...process.env, ...env } })
  return { code: result.status, out: `${result.stdout}${result.stderr}` }
}

describe("operator command guards (no database needed)", () => {
  it("password reset refuses a production-labelled database without the operator confirmation", () => {
    const r = runScript("scripts/account-password.mts", ["someone@example.test"], { MATCHBASE_DATABASE_LABEL: "production", MATCHBASE_NEW_PASSWORD: "irrelevant-password-1" })
    assert.equal(r.code, 3)
    assert.match(r.out, /MATCHBASE_OPERATOR_TARGET=production/)
    assert.doesNotMatch(r.out, /irrelevant-password-1/)
  })
  it("migration deployment refuses the same way and never resets", () => {
    const refused = runScript("scripts/migrate-deploy.mts", [], { MATCHBASE_DATABASE_LABEL: "production" })
    assert.equal(refused.code, 3)
    const reset = runScript("scripts/migrate-deploy.mts", ["--reset"], {})
    assert.equal(reset.code, 2)
    assert.match(reset.out, /never run/)
  })
  it("the demo seed refuses Production intent before connecting", () => {
    const r = runScript("prisma/seed.ts", [], { VERCEL_ENV: "production", DATABASE_URL_UNPOOLED: "postgresql://nobody:nothing@127.0.0.1:1/none", DATABASE_URL: "postgresql://nobody:nothing@127.0.0.1:1/none" })
    assert.equal(r.code, 3)
    assert.match(r.out, /Seed refused/)
  })
})

describeDb("operator password reset (database)", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) })
  const stamp = `${Date.now()}`
  const email = `reset-${stamp}@example.test`
  const OLD = "old-password-123456"
  const NEW = "new-password-654321"
  let auth: Auth

  before(async () => {
    auth = createAuth({ prisma, env: { DATABASE_URL: url, BETTER_AUTH_SECRET: "test-only-secret-0123456789abcdef0123456789", NODE_ENV: "test" } })
    await auth.api.signUpEmail({ body: { name: "Reset", email, password: OLD } })
    await auth.api.signInEmail({ body: { email, password: OLD } })
  })

  after(async () => {
    await prisma.user.deleteMany({ where: { email } })
    await prisma.$disconnect()
  })

  it("sets a new password through Better Auth's hashing, revokes sessions, prints nothing sensitive", async () => {
    assert.ok((await prisma.session.count({ where: { user: { email } } })) >= 1)
    const r = runScript("scripts/account-password.mts", [email], { MATCHBASE_NEW_PASSWORD: NEW })
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /Password updated/)
    assert.match(r.out, /session\(s\) revoked/)
    assert.doesNotMatch(r.out, new RegExp(NEW))
    assert.doesNotMatch(r.out, /postgresql:\/\//)
    assert.equal(await prisma.session.count({ where: { user: { email } } }), 0)
    await assert.rejects(() => auth.api.signInEmail({ body: { email, password: OLD } }))
    const { response } = await auth.api.signInEmail({ body: { email, password: NEW }, returnHeaders: true })
    assert.equal(response.user.email, email)
  })

  it("invalidates an outstanding self-service reset link, so it cannot be used after the operator reset", async () => {
    // A recovery-enabled instance (development shape, capture mailer) issues a real Better Auth reset token.
    const capture = createCaptureMailer({})
    const recovery = createAuth({
      prisma,
      env: { DATABASE_URL: url, BETTER_AUTH_SECRET: "test-only-secret-0123456789abcdef0123456789", NODE_ENV: "development", BETTER_AUTH_URL: "http://localhost:3000", AUTH_ALLOW_SIGN_UP: "false", MAIL_TRANSPORT: "dev-outbox", MAIL_FROM: "dev@example.test", AUTH_PASSWORD_RESET_ENABLED: "true" },
      mailer: capture,
    })
    await recovery.api.requestPasswordReset({ body: { email } })
    const token = /#token=([A-Za-z0-9_-]+)/.exec(capture.messages.at(-1)?.text ?? "")?.[1]
    assert.ok(token, "a reset link was issued")
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })
    assert.equal(await prisma.verification.count({ where: { value: user.id } }), 1)

    const r = runScript("scripts/account-password.mts", [email], { MATCHBASE_NEW_PASSWORD: NEW })
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /1 outstanding reset link\(s\) invalidated/)
    assert.equal(await prisma.verification.count({ where: { value: user.id } }), 0)
    await assert.rejects(
      () => recovery.api.resetPassword({ body: { token, newPassword: "attacker-chosen-password" } }),
      (error: { body?: { code?: string } }) => error.body?.code === "INVALID_TOKEN"
    )
    const { response } = await recovery.api.signInEmail({ body: { email, password: NEW }, returnHeaders: true })
    assert.equal(response.user.email, email, "the operator's password still works")
    await prisma.session.deleteMany({ where: { user: { email } } })
  })

  it("refuses an unknown account and a short password", () => {
    assert.equal(runScript("scripts/account-password.mts", [`missing-${stamp}@example.test`], { MATCHBASE_NEW_PASSWORD: NEW }).code, 1)
    assert.equal(runScript("scripts/account-password.mts", [email], { MATCHBASE_NEW_PASSWORD: "short" }).code, 1)
  })
})
