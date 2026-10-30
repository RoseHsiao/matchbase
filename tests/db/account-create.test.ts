import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, before, describe, it } from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"

import { createAuth, type Auth } from "../../lib/auth/create-auth"
import { PrismaClient } from "../../lib/generated/prisma/client"

/**
 * Operator account creation (scripts/account-create.mts): a real Better Auth
 * credential account that starts as USER, with no session left behind, that
 * signs in through the normal path, and that the admin-role command can then
 * promote. Guards are checked without a database.
 */

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file)
}
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

function run(args: string[], env: Record<string, string | undefined>) {
  const result = spawnSync("npx", ["tsx", "scripts/account-create.mts", ...args], { encoding: "utf8", env: { ...process.env, ...env } })
  return { code: result.status, out: `${result.stdout}${result.stderr}` }
}

describe("account:create guards (no database needed)", () => {
  it("refuses a production-labelled database without the operator confirmation, without printing the password", () => {
    const r = run(["someone@example.test"], { MATCHBASE_DATABASE_LABEL: "production", MATCHBASE_NEW_PASSWORD: "irrelevant-password-1" })
    assert.equal(r.code, 3)
    assert.match(r.out, /MATCHBASE_OPERATOR_TARGET=production/)
    assert.doesNotMatch(r.out, /irrelevant-password-1/)
  })
  it("requires an email", () => {
    assert.equal(run([], { MATCHBASE_NEW_PASSWORD: "irrelevant-password-1" }).code, 1)
    assert.equal(run(["--name", "X"], { MATCHBASE_NEW_PASSWORD: "irrelevant-password-1" }).code, 1)
  })
})

describeDb("account:create (database)", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) })
  const stamp = `${Date.now()}`
  const email = `created-${stamp}@example.test`
  const PASSWORD = "created-password-123456"
  let auth: Auth

  before(() => {
    auth = createAuth({ prisma, env: { DATABASE_URL: url, BETTER_AUTH_SECRET: "test-only-secret-0123456789abcdef0123456789", NODE_ENV: "test", VERCEL_ENV: "preview", BETTER_AUTH_URL: "https://preview.example" } })
  })

  after(async () => {
    await prisma.user.deleteMany({ where: { email } })
    await prisma.$disconnect()
  })

  it("creates a USER with a real credential and no session, printing nothing sensitive", async () => {
    const r = run([email, "--name", "Created Person"], { MATCHBASE_NEW_PASSWORD: PASSWORD, BETTER_AUTH_SECRET: undefined })
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /role USER/)
    assert.match(r.out, /credential credential/)
    assert.doesNotMatch(r.out, new RegExp(PASSWORD))
    assert.doesNotMatch(r.out, /postgresql:\/\//)
    const row = await prisma.user.findUniqueOrThrow({ where: { email }, select: { name: true, role: true, emailVerified: true, sessions: true, accounts: { select: { providerId: true, password: true } } } })
    assert.equal(row.name, "Created Person")
    assert.equal(row.role, "USER")
    assert.equal(row.sessions.length, 0, "the bootstrap session was discarded")
    assert.equal(row.accounts.length, 1)
    assert.equal(row.accounts[0].providerId, "credential")
    assert.ok((row.accounts[0].password ?? "").length > 40, "scrypt hash stored")
  })

  it("never sends mail, even when the operator shell carries a complete Resend configuration", async () => {
    const mailEmail = `created-mail-${stamp}@example.test`
    const log = path.join(mkdtempSync(path.join(tmpdir(), "account-create-fetch-")), "fetch.log")
    // Everything a mail-sending auth instance needs, including an allowlist that admits this very address:
    // without isolation, Better Auth's sign-up would send a verification email through Resend here.
    const result = spawnSync("npx", ["tsx", "--import", "./tests/fixtures/record-fetch.mjs", "scripts/account-create.mts", mailEmail], {
      encoding: "utf8",
      env: {
        ...process.env,
        MATCHBASE_NEW_PASSWORD: PASSWORD,
        RECORD_FETCH_TO: log,
        MAIL_TRANSPORT: "resend",
        MAIL_FROM: "MatchBase <noreply@mail.matchbase.example>",
        RESEND_API_KEY: "re_OperatorShellKey_0123456789abcdef",
        MAIL_ALLOWED_RECIPIENTS: mailEmail,
        AUTH_PASSWORD_RESET_ENABLED: "true",
        AUTH_EMAIL_VERIFICATION_ENABLED: "true",
      },
    })
    try {
      assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
      assert.equal(existsSync(log) ? readFileSync(log, "utf8") : "", "", "no outbound request was attempted")
      // Stronger than "no request": the operator instance must have no mail hook at all. A hook that merely
      // fails to build a link today (no base URL in the operator shell) would send once one is available.
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, /\[mail\]|verification link|reset link|no mail sent/)
      const row = await prisma.user.findUniqueOrThrow({ where: { email: mailEmail }, select: { emailVerified: true, sessions: { select: { id: true } } } })
      assert.equal(row.emailVerified, false, "creating an account does not confirm it")
      assert.equal(row.sessions.length, 0)
    } finally {
      await prisma.user.deleteMany({ where: { email: mailEmail } })
    }
  })

  it("the account signs in through the normal path even where public sign-up is closed", async () => {
    // This instance is Preview-shaped: sign-up closed. Sign-in must still work for the created account.
    await assert.rejects(() => auth.api.signUpEmail({ body: { name: "X", email: `blocked-${stamp}@example.test`, password: PASSWORD } }))
    const { response } = await auth.api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true })
    assert.equal(response.user.email, email)
    await prisma.session.deleteMany({ where: { user: { email } } })
  })

  it("refuses a duplicate and a short password", () => {
    assert.equal(run([email], { MATCHBASE_NEW_PASSWORD: PASSWORD }).code, 1)
    assert.equal(run([`short-${stamp}@example.test`], { MATCHBASE_NEW_PASSWORD: "short" }).code, 1)
  })

  it("can then be promoted with the existing admin-role command", () => {
    const grant = spawnSync("npx", ["tsx", "scripts/admin-role.mts", "grant", email], { encoding: "utf8", env: process.env })
    assert.equal(grant.status, 0, `${grant.stdout}${grant.stderr}`)
    assert.match(grant.stdout, /now an administrator/)
  })
})
