import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { after, describe, it } from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"

import { PrismaClient } from "../../lib/generated/prisma/client"

/** The operator fallback `account:verify` (scripts/account-verify.mts): guard, status, confirm, idempotence. */

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file)
}
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

function run(args: string[], env: Record<string, string | undefined> = {}) {
  const result = spawnSync("npx", ["tsx", "scripts/account-verify.mts", ...args], { encoding: "utf8", env: { ...process.env, ...env } })
  return { code: result.status, out: `${result.stdout}${result.stderr}` }
}

describe("account:verify guards (no database needed)", () => {
  it("refuses a production-labelled database without the operator confirmation, and bad usage", () => {
    const refused = run(["confirm", "someone@example.test"], { MATCHBASE_DATABASE_LABEL: "production" })
    assert.equal(refused.code, 3)
    assert.match(refused.out, /MATCHBASE_OPERATOR_TARGET=production/)
    assert.equal(run(["grant", "someone@example.test"]).code, 1)
    assert.equal(run(["confirm", "not-an-email"]).code, 1)
  })
})

describeDb("account:verify (database)", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) })
  const address = `account-verify-${stamp}@example.test`
  after(async () => {
    await prisma.user.deleteMany({ where: { email: address } })
    await prisma.$disconnect()
  })

  it("reports, confirms once, and changes nothing else", async () => {
    const user = await prisma.user.create({ data: { email: address, name: "Operator Verified" }, select: { id: true, role: true } })
    assert.match(run(["status", address]).out, /not confirmed/)
    const confirmed = run(["confirm", address])
    assert.equal(confirmed.code, 0)
    assert.match(confirmed.out, /marked as confirmed by the operator/)
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { emailVerified: true, role: true } })
    assert.deepEqual(after, { emailVerified: true, role: user.role })
    assert.equal(await prisma.session.count({ where: { userId: user.id } }), 0, "no session is created")
    assert.match(run(["confirm", address]).out, /already confirmed/)
    assert.equal(run(["status", `missing-${address}`]).code, 1)
  })
})
