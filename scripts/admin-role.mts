import { PrismaPg } from "@prisma/adapter-pg"
import { hashPassword, verifyPassword } from "better-auth/crypto"

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../lib/auth/password-policy"
import { operatorPolicy } from "../lib/env/runtime-environment"
import { PrismaClient } from "../lib/generated/prisma/client"
import { readOperatorPassword } from "./shared/read-password"

/**
 * Operator CLI for the ADMIN role: the only way a MatchBase account becomes
 * an administrator. Runs where the database URLs are (an operator's shell or
 * a deployment job), never from the browser, and never automatically.
 *
 *   npm run admin:role -- list
 *   npm run admin:role -- grant someone@example.com
 *   npm run admin:role -- revoke someone@example.com
 *
 * The account must already exist (`npm run account:create`, or the person's
 * own sign-up); the script never creates users. Database sessions carry no
 * role, so a change applies on the user's next request. Against a
 * production-labelled database it requires MATCHBASE_OPERATOR_TARGET=production.
 * Exit codes: 0 done, 1 usage, missing or unsuitable account, 2 database or
 * configuration error, 3 refused by the operator guard.
 *
 * Grant re-establishes who holds the account (docs/security/production-hardening.md,
 * "ADMIN grant safety"). Nothing in the database proves who registered an
 * address: while public sign-up is open without verification, anyone can
 * register the address an operator later means to promote, and an
 * operator-created account looks the same as a self-registered one, with or
 * without emailVerified. So `grant` does not trust the existing credential.
 * In one transaction it:
 *
 * - sets a new password from MATCHBASE_NEW_PASSWORD or a hidden prompt;
 * - revokes every session of the account;
 * - deletes the account's outstanding reset links;
 * - sets the role.
 *
 * The operator then hands the new password to the intended person out of
 * band, the same trust root `account:create` relies on. Once that holds, the
 * old password no longer signs in and every session that existed before the
 * transaction is gone. An account that is already an administrator is left
 * untouched; `revoke` is unchanged.
 *
 * Known limitation, NOT race-free: a sign-in that verified the old password
 * just before the transaction committed can still create its session after
 * the transaction's revoke, and that session would act with the new role.
 * As a risk-reduction measure only, grant waits a short, fixed time and
 * revokes the account's sessions a second time. A sign-in slower than that
 * wait, or one that completes after the second revoke, is not caught. No test
 * exercises concurrent sign-ins, so nothing here proves the race is closed.
 * Narrow the window further by granting when the address is not in use
 * (for example, sign-up closed or the account just created by the operator).
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
if (command !== "list") console.log(`Target database: ${operator.target}.`)

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

/**
 * How long grant waits before revoking sessions a second time. A heuristic
 * that reduces the risk of a concurrent sign-in with the old password; it is
 * not a bound on how long such a sign-in can take, and not a guarantee.
 */
const SIGN_IN_RACE_GRACE_MS = 2_000

async function grantWithNewCredential(user: { id: string; accounts: { id: string; providerId: string }[] }, email: string): Promise<void> {
  // Only a single email/password credential can be re-keyed. Any other linked sign-in method (none exists today)
  // could still be held by whoever registered the address, so it is refused rather than left in place.
  const credentials = user.accounts.filter((account) => account.providerId === "credential")
  if (credentials.length !== 1 || user.accounts.length !== 1) {
    console.error(`${email} has ${user.accounts.length} sign-in method(s) (${user.accounts.map((a) => a.providerId).join(", ")}); grant needs exactly one email/password credential it can re-establish. Nothing changed.`)
    process.exit(1)
  }
  console.log("Grant sets a new password: the existing one may belong to whoever registered this address. Hand the new password to the intended administrator out of band.")
  const password = await readOperatorPassword("MATCHBASE_NEW_PASSWORD", `New password for administrator ${email}: `)
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    console.error(`The password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters. Nothing changed.`)
    process.exit(1)
  }
  const hash = await hashPassword(password)
  if (!(await verifyPassword({ hash, password }))) throw new Error("The new hash did not verify; nothing was written.")
  // The credential row is matched on its id and owner and must still be the same row. The role changes in the
  // same transaction as the re-key and the revoke, so no session that existed before it becomes an administrator.
  // A sign-in racing this transaction is the known gap described in the header comment.
  const [, sessions, links] = await prisma.$transaction([
    prisma.account.update({ where: { id: credentials[0].id, userId: user.id, providerId: "credential" }, data: { password: hash } }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
    prisma.verification.deleteMany({ where: { value: user.id } }),
    prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } }),
  ])
  // Second revoke: reduces, does not eliminate, the window for a racing sign-in (header comment).
  await new Promise((resolve) => setTimeout(resolve, SIGN_IN_RACE_GRACE_MS))
  const late = await prisma.session.deleteMany({ where: { userId: user.id } })
  console.log(`${email} is now an administrator with a new password; ${sessions.count + late.count} earlier session(s) revoked, ${links.count} outstanding reset link(s) invalidated. Give the password to the intended person out of band and ask them to change it after signing in.`)
}

try {
  if (command === "list") {
    const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { email: true, name: true, createdAt: true }, orderBy: { email: "asc" } })
    if (admins.length === 0) console.log("No administrators. Grant one with: npm run admin:role -- grant <email>")
    for (const admin of admins) console.log(`${admin.email}\t${admin.name || "(no name)"}\tsince ${admin.createdAt.toISOString().slice(0, 10)}`)
  } else {
    const email = normalizeEmail(emailArg)
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true, accounts: { select: { id: true, providerId: true } } } })
    if (!user) {
      console.error(`No account with email ${email}. Create it first with npm run account:create; this script never creates accounts.`)
      process.exit(1)
    }
    if (user.accounts.length === 0) {
      console.error(`${email} has no sign-in credential (it is a seed or placeholder user) and cannot be an administrator.`)
      process.exit(1)
    }
    const role = command === "grant" ? "ADMIN" : "USER"
    if (user.role === role) {
      console.log(`${email} is already ${role === "ADMIN" ? "an administrator" : "a regular user"}; nothing changed.`)
    } else if (command === "revoke") {
      await prisma.user.update({ where: { id: user.id }, data: { role } })
      console.log(`${email} is now a regular user. The change applies on their next request.`)
    } else {
      await grantWithNewCredential(user, email)
    }
  }
} catch (error) {
  console.error("Could not update the role:", error instanceof Error ? error.message : String(error))
  process.exit(2)
} finally {
  await prisma.$disconnect()
}
