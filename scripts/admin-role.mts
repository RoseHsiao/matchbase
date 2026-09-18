import { PrismaPg } from "@prisma/adapter-pg"

import { PrismaClient } from "../lib/generated/prisma/client"

/**
 * Operator CLI for the ADMIN role: the only way a MatchBase account becomes
 * an administrator. Runs where the database URLs are (an operator's shell or
 * a deployment job), never from the browser, and never automatically.
 *
 *   npm run admin:role -- list
 *   npm run admin:role -- grant someone@example.com
 *   npm run admin:role -- revoke someone@example.com
 *
 * The account must already exist (the person signs up first); the script
 * never creates users or passwords. Database sessions carry no role, so a
 * change applies on the user's next request. Exit codes: 0 done, 1 usage or
 * missing account, 2 database or configuration error.
 */

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file)
  } catch {
    // Optional: CI and deployment jobs inject variables directly.
  }
}

type Command = "list" | "grant" | "revoke"

function usage(): never {
  console.error("Usage: npm run admin:role -- list | grant <email> | revoke <email>")
  process.exit(1)
}

function normalizeEmail(value: string | undefined): string {
  const email = value?.trim().toLowerCase() ?? ""
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) usage()
  return email
}

const [command, emailArg] = process.argv.slice(2) as [Command | undefined, string | undefined]
if (command !== "list" && command !== "grant" && command !== "revoke") usage()

const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
if (!connectionString) {
  console.error("DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set.")
  process.exit(2)
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

try {
  if (command === "list") {
    const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { email: true, name: true, createdAt: true }, orderBy: { email: "asc" } })
    if (admins.length === 0) console.log("No administrators. Grant one with: npm run admin:role -- grant <email>")
    for (const admin of admins) console.log(`${admin.email}\t${admin.name || "(no name)"}\tsince ${admin.createdAt.toISOString().slice(0, 10)}`)
  } else {
    const email = normalizeEmail(emailArg)
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true, accounts: { select: { id: true }, take: 1 } } })
    if (!user) {
      console.error(`No account with email ${email}. The person must sign up first; this script never creates accounts.`)
      process.exit(1)
    }
    if (user.accounts.length === 0) {
      console.error(`${email} has no sign-in credential (it is a seed or placeholder user) and cannot be an administrator.`)
      process.exit(1)
    }
    const role = command === "grant" ? "ADMIN" : "USER"
    if (user.role === role) {
      console.log(`${email} is already ${role === "ADMIN" ? "an administrator" : "a regular user"}.`)
    } else {
      await prisma.user.update({ where: { id: user.id }, data: { role } })
      console.log(`${email} is now ${role === "ADMIN" ? "an administrator" : "a regular user"}. The change applies on their next request.`)
    }
  }
} catch (error) {
  console.error("Could not update the role:", error instanceof Error ? error.message : String(error))
  process.exit(2)
} finally {
  await prisma.$disconnect()
}
