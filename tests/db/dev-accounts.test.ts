import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { after, before, describe, it } from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"

import { createAuth, type Auth } from "../../lib/auth/create-auth"
import { provisionDevAccounts } from "../../lib/auth/dev-accounts"
import { resolveDevLogin } from "../../lib/auth/dev-login"
import { PrismaClient } from "../../lib/generated/prisma/client"

/**
 * The development accounts are ordinary Better Auth accounts: created through
 * sign-up (hashed credential row), given their role directly, idempotent, and
 * able to sign in through the normal path. Uses unique test emails and
 * deletes them afterwards. Skipped without a database URL.
 */

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file)
}
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const env = {
  DATABASE_URL: url,
  BETTER_AUTH_SECRET: "test-only-secret-0123456789abcdef0123456789",
  NODE_ENV: "test",
  MATCHBASE_DEV_LOGIN: "true",
  MATCHBASE_DEV_USER_EMAIL: `dev-user-${stamp}@example.test`,
  MATCHBASE_DEV_USER_PASSWORD: "dev-user-password-1",
  MATCHBASE_DEV_ADMIN_EMAIL: `dev-admin-${stamp}@example.test`,
  MATCHBASE_DEV_ADMIN_PASSWORD: "dev-admin-password-1",
}

describeDb("development quick sign-in accounts (database)", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) })
  let auth: Auth

  before(() => {
    auth = createAuth({ prisma, env })
  })

  after(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${stamp}@example.test` } } })
    await prisma.$disconnect()
  })

  it("creates a USER and an ADMIN with real credentials, then leaves them alone", async () => {
    const policy = resolveDevLogin(env)
    assert.equal(policy.enabled, true)
    if (!policy.enabled) return
    const first = await provisionDevAccounts({ auth, prisma }, policy.accounts)
    assert.deepEqual(first.map((r) => [r.role, r.created, r.roleChanged]), [["USER", true, false], ["ADMIN", true, true]])
    const rows = await prisma.user.findMany({ where: { email: { endsWith: `-${stamp}@example.test` } }, select: { email: true, role: true, accounts: { select: { providerId: true, password: true } } }, orderBy: { email: "asc" } })
    assert.equal(rows.length, 2)
    for (const row of rows) {
      assert.equal(row.accounts.length, 1)
      assert.equal(row.accounts[0].providerId, "credential")
      assert.ok((row.accounts[0].password ?? "").length > 40, "hashed, never the plain password")
    }
    assert.equal(rows.find((r) => r.email.startsWith("dev-admin"))?.role, "ADMIN")
    assert.equal(rows.find((r) => r.email.startsWith("dev-user"))?.role, "USER")

    const second = await provisionDevAccounts({ auth, prisma }, policy.accounts)
    assert.deepEqual(second.map((r) => [r.created, r.roleChanged]), [[false, false], [false, false]])
    assert.equal(await prisma.user.count({ where: { email: { endsWith: `-${stamp}@example.test` } } }), 2)
  })

  it("repairs a role that drifted and refuses an email without a credential", async () => {
    const policy = resolveDevLogin(env)
    if (!policy.enabled) return
    await prisma.user.update({ where: { email: env.MATCHBASE_DEV_ADMIN_EMAIL }, data: { role: "USER" } })
    const repaired = await provisionDevAccounts({ auth, prisma }, policy.accounts)
    assert.equal(repaired[1].roleChanged, true)
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { email: env.MATCHBASE_DEV_ADMIN_EMAIL }, select: { role: true } })).role, "ADMIN")

    await prisma.user.create({ data: { email: `placeholder-${stamp}@example.test`, name: "Placeholder" } })
    await assert.rejects(
      () => provisionDevAccounts({ auth, prisma }, [{ role: "USER", name: "X", email: `placeholder-${stamp}@example.test`, password: "placeholder-pass-1" }]),
      /without a sign-in credential/
    )
  })

  it("both accounts sign in through the normal Better Auth path", async () => {
    const policy = resolveDevLogin(env)
    if (!policy.enabled) return
    for (const account of policy.accounts) {
      const { response } = await auth.api.signInEmail({ body: { email: account.email, password: account.password }, returnHeaders: true })
      assert.equal(response.user.email, account.email)
    }
    await assert.rejects(() => auth.api.signInEmail({ body: { email: policy.accounts[1].email, password: "wrong-password-xx" } }))
  })
})
