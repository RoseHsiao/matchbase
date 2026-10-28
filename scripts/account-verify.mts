import { PrismaPg } from "@prisma/adapter-pg"

import { operatorPolicy } from "../lib/env/runtime-environment"
import { PrismaClient } from "../lib/generated/prisma/client"

/**
 * Operator assertion that an account's email address is confirmed, for the
 * one case the email flow cannot cover: before public sign-up is opened
 * (which turns on required verification), operator-created accounts such as
 * the first ADMIN must not be locked out if mail is unavailable at that
 * moment (docs/security/account-recovery.md, "Opening public sign-up").
 * The normal path is the emailed link; this is the documented fallback.
 *
 *   npm run account:verify -- status someone@example.com
 *   npm run account:verify -- confirm someone@example.com
 *
 * `confirm` sets User.emailVerified=true and nothing else: no session, no
 * password, no role. It never creates an account. Against a
 * production-labelled database it requires MATCHBASE_OPERATOR_TARGET=production.
 * Exit codes: 0 done, 1 usage or missing account, 2 database or
 * configuration error, 3 refused by the operator guard.
 */

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file)
  } catch {
    // optional
  }
}

const [command, emailArg] = process.argv.slice(2)
const email = emailArg?.trim().toLowerCase() ?? ""
if ((command !== "status" && command !== "confirm") || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: npm run account:verify -- status <email> | confirm <email>")
  process.exit(1)
}
const operator = operatorPolicy(process.env)
if (!operator.allowed) {
  console.error(`Refused: ${operator.reason}`)
  process.exit(3)
}
const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
if (!connectionString) {
  console.error("DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set.")
  process.exit(2)
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
try {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, emailVerified: true } })
  if (!user) {
    console.error(`No account with email ${email}.`)
    process.exit(1)
  }
  if (command === "status") {
    console.log(`${email}: email ${user.emailVerified ? "confirmed" : "not confirmed"} (${operator.target} database).`)
  } else if (user.emailVerified) {
    console.log(`${email} is already confirmed (${operator.target} database); nothing changed.`)
  } else {
    await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } })
    console.log(`${email} marked as confirmed by the operator (${operator.target} database).`)
  }
} catch (error) {
  console.error("Could not update the account:", error instanceof Error ? error.message.split("\n")[0] : String(error))
  process.exit(2)
} finally {
  await prisma.$disconnect()
}
