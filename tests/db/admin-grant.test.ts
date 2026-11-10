import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { after, before, describe, it } from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"

import { toViewer } from "../../lib/auth/authorization"
import { createAuth, type Auth } from "../../lib/auth/create-auth"
import { PrismaClient } from "../../lib/generated/prisma/client"

/**
 * ADMIN grant safety (scripts/admin-role.mts, docs/security/production-hardening.md
 * "ADMIN grant safety"). While public sign-up is open without verification an
 * attacker can register the address an operator later promotes. Grant must
 * therefore never hand the administrator role to whoever holds the existing
 * credential: it sets an operator-chosen password and revokes every session
 * first. Runs only against the database labelled `development`; every account
 * carries `grant-…-<stamp>@example.test` and only those are deleted.
 */

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file)
}
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const SECRET = "test-only-secret-0123456789abcdef0123456789"
const BASE = "http://localhost:3000"
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const email = (label: string) => `grant-${label}-${stamp}@example.test`
const ATTACKER_PASSWORD = "attacker chose this password"
const OPERATOR_PASSWORD = "operator handed this over 1"
/** Public sign-up as a deployment with both flags would serve it. */
const PUBLIC = { DATABASE_URL: url, BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: BASE, VERCEL_ENV: "preview", AUTH_ALLOW_SIGN_UP: "true", AUTH_ALLOW_UNVERIFIED_SIGN_UP: "true" }

type ApiFailure = { body?: { code?: string } }

function cli(script: string, args: string[], env: Record<string, string | undefined> = {}) {
  // No TTY here: without MATCHBASE_NEW_PASSWORD the commands must refuse instead of prompting.
  const result = spawnSync("npx", ["tsx", script, ...args], { encoding: "utf8", env: { ...process.env, MATCHBASE_NEW_PASSWORD: undefined, ...env } })
  return { code: result.status, out: `${result.stdout}${result.stderr}` }
}

function cookieHeader(setCookie: string | null): Headers {
  const cookie = (setCookie ?? "").split(/,(?=\s*[^;,]+=)/).map((part) => part.split(";")[0].trim()).filter(Boolean).join("; ")
  return new Headers({ cookie })
}

describeDb("ADMIN grant safety (development database)", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }), transactionOptions: { timeout: 30_000, maxWait: 10_000 } })
  let publicAuth: Auth

  async function squat(label: string): Promise<Headers> {
    const { headers } = await publicAuth.api.signUpEmail({ body: { name: "Not the admin", email: email(label), password: ATTACKER_PASSWORD }, returnHeaders: true })
    return cookieHeader(headers.get("set-cookie"))
  }

  async function signInFails(address: string, password: string): Promise<string | undefined> {
    try {
      await publicAuth.api.signInEmail({ body: { email: address, password } })
    } catch (error) {
      return (error as ApiFailure).body?.code
    }
    return undefined
  }

  async function credentialHash(address: string): Promise<string | null> {
    const row = await prisma.account.findFirstOrThrow({ where: { user: { email: address }, providerId: "credential" }, select: { password: true } })
    return row.password
  }

  before(() => {
    assert.equal(process.env.MATCHBASE_DATABASE_LABEL?.trim().toLowerCase(), "development", "these tests write accounts; they run only against the development database")
    publicAuth = createAuth({ prisma, env: PUBLIC })
  })

  after(async () => {
    await prisma.user.deleteMany({ where: { AND: [{ email: { startsWith: "grant-" } }, { email: { endsWith: `-${stamp}@example.test` } }] } })
    await prisma.$disconnect()
  })

  it("pre-registered address: grant re-keys it, so the squatter's password and session die before the role is ADMIN", async () => {
    const squatterSession = await squat("squatted")
    assert.equal(toViewer((await publicAuth.api.getSession({ headers: squatterSession }))!.user).role, "USER")

    const r = cli("scripts/admin-role.mts", ["grant", email("squatted")], { MATCHBASE_NEW_PASSWORD: OPERATOR_PASSWORD })
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /now an administrator with a new password; [1-9]\d* earlier session\(s\) revoked/)
    assert.doesNotMatch(r.out, new RegExp(`${OPERATOR_PASSWORD}|${ATTACKER_PASSWORD}`))

    assert.equal(await publicAuth.api.getSession({ headers: squatterSession }), null, "the squatter's session is gone")
    assert.equal(await signInFails(email("squatted"), ATTACKER_PASSWORD), "INVALID_EMAIL_OR_PASSWORD", "the squatter's password no longer works")
    const { headers } = await publicAuth.api.signInEmail({ body: { email: email("squatted"), password: OPERATOR_PASSWORD }, returnHeaders: true })
    const admin = await publicAuth.api.getSession({ headers: cookieHeader(headers.get("set-cookie")) })
    assert.equal(toViewer(admin!.user).role, "ADMIN", "only the holder of the operator's password is the administrator")
  })

  it("grant never promotes without a new password: no TTY and no MATCHBASE_NEW_PASSWORD, or a short one, changes nothing", async () => {
    await squat("nopassword")
    const before = await credentialHash(email("nopassword"))
    for (const env of [{}, { MATCHBASE_NEW_PASSWORD: "short" }]) {
      const r = cli("scripts/admin-role.mts", ["grant", email("nopassword")], env)
      assert.equal(r.code, 1, r.out)
      const row = await prisma.user.findUniqueOrThrow({ where: { email: email("nopassword") }, select: { role: true, sessions: { select: { id: true } } } })
      assert.equal(row.role, "USER")
      assert.equal(row.sessions.length, 1, "the account's session is untouched when nothing is granted")
      assert.equal(await credentialHash(email("nopassword")), before)
    }
  })

  it("account:create on a pre-registered address refuses, says why, and leaves the account exactly as it was", async () => {
    await squat("create-existing")
    const before = await prisma.user.findUniqueOrThrow({ where: { email: email("create-existing") }, select: { role: true, name: true, updatedAt: true } })
    const hash = await credentialHash(email("create-existing"))
    const r = cli("scripts/account-create.mts", [email("create-existing")], { MATCHBASE_NEW_PASSWORD: OPERATOR_PASSWORD })
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, /already exists and was NOT created by this command/)
    assert.match(r.out, /registered by someone else through public sign-up/)
    assert.match(r.out, /admin:role -- grant/)
    assert.doesNotMatch(r.out, new RegExp(OPERATOR_PASSWORD))
    assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { email: email("create-existing") }, select: { role: true, name: true, updatedAt: true } }), before)
    assert.equal(await credentialHash(email("create-existing")), hash)
    assert.equal(await signInFails(email("create-existing"), ATTACKER_PASSWORD), undefined, "still the squatter's account until a grant re-keys it")
  })

  it("normal path: account:create, then grant with the password to hand over; the new admin signs in", async () => {
    const created = cli("scripts/account-create.mts", [email("normal"), "--name", "Intended Admin"], { MATCHBASE_NEW_PASSWORD: OPERATOR_PASSWORD })
    assert.equal(created.code, 0, created.out)
    assert.match(created.out, /grant sets the password again/)
    const row = await prisma.user.findUniqueOrThrow({ where: { email: email("normal") }, select: { role: true, emailVerified: true, sessions: { select: { id: true } } } })
    assert.deepEqual({ role: row.role, emailVerified: row.emailVerified, sessions: row.sessions.length }, { role: "USER", emailVerified: false, sessions: 0 }, "account:create neither confirms the address nor leaves a session")

    const granted = cli("scripts/admin-role.mts", ["grant", email("normal")], { MATCHBASE_NEW_PASSWORD: OPERATOR_PASSWORD })
    assert.equal(granted.code, 0, granted.out)
    const { headers } = await publicAuth.api.signInEmail({ body: { email: email("normal"), password: OPERATOR_PASSWORD }, returnHeaders: true })
    assert.equal(toViewer((await publicAuth.api.getSession({ headers: cookieHeader(headers.get("set-cookie")) }))!.user).role, "ADMIN")
  })

  it("an existing administrator is left alone by a repeated grant (no new password asked, sessions kept); revoke still works", async () => {
    // The administrator from the previous case, signed in.
    const { headers } = await publicAuth.api.signInEmail({ body: { email: email("normal"), password: OPERATOR_PASSWORD }, returnHeaders: true })
    const cookies = cookieHeader(headers.get("set-cookie"))
    const hash = await credentialHash(email("normal"))
    const again = cli("scripts/admin-role.mts", ["grant", email("normal")])
    assert.equal(again.code, 0, again.out)
    assert.match(again.out, /already an administrator; nothing changed/)
    assert.equal(await credentialHash(email("normal")), hash)
    assert.equal(toViewer((await publicAuth.api.getSession({ headers: cookies }))!.user).role, "ADMIN", "the session survives")

    const revoked = cli("scripts/admin-role.mts", ["revoke", email("normal")])
    assert.equal(revoked.code, 0, revoked.out)
    assert.equal(toViewer((await publicAuth.api.getSession({ headers: cookies }))!.user).role, "USER")
    assert.equal(await credentialHash(email("normal")), hash, "revoke does not touch the credential")
  })

  it("refuses an account with a second sign-in method it cannot re-key", async () => {
    await squat("linked")
    const user = await prisma.user.findUniqueOrThrow({ where: { email: email("linked") }, select: { id: true } })
    await prisma.account.create({ data: { userId: user.id, accountId: `linked-${stamp}`, providerId: "example-oauth" } })
    const r = cli("scripts/admin-role.mts", ["grant", email("linked")], { MATCHBASE_NEW_PASSWORD: OPERATOR_PASSWORD })
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, /2 sign-in method\(s\).*Nothing changed/)
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { role: true } })).role, "USER")
  })
})
