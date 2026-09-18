import { createInterface } from "node:readline/promises"

import { PrismaPg } from "@prisma/adapter-pg"
import { hashPassword, verifyPassword } from "better-auth/crypto"

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../lib/auth/password-policy"
import { operatorPolicy } from "../lib/env/runtime-environment"
import { PrismaClient } from "../lib/generated/prisma/client"

/**
 * Operator password reset for an existing email/password account, for a
 * deployment without mail delivery (docs/security/production-hardening.md,
 * "Password recovery").
 *
 *   npm run account:password -- someone@example.com
 *
 * The new password is read from the MATCHBASE_NEW_PASSWORD variable of this
 * invocation or, failing that, prompted for without echo. It is hashed with
 * Better Auth's own scrypt implementation (`better-auth/crypto`), written to
 * the account's credential row, verified by reading it back through the
 * same library, and every session of the account is revoked so a stolen
 * session dies with the old password. Nothing sensitive is printed. The
 * operator hands the new password to the person out of band and asks them
 * to change it after signing in. Refused against a production-labelled
 * database without MATCHBASE_OPERATOR_TARGET=production.
 */

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file)
  } catch {
    // optional
  }
}

const email = process.argv[2]?.trim().toLowerCase() ?? ""
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: npm run account:password -- <email>   (new password from MATCHBASE_NEW_PASSWORD or a hidden prompt)")
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

async function readPassword(): Promise<string> {
  const fromEnv = process.env.MATCHBASE_NEW_PASSWORD
  if (fromEnv) return fromEnv
  if (!process.stdin.isTTY) {
    console.error("No TTY: set MATCHBASE_NEW_PASSWORD for this invocation.")
    process.exit(1)
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  // Hide the typed characters: readline echoes through the output stream, so mute it while the answer is typed.
  const output = process.stdout as NodeJS.WriteStream & { muted?: boolean }
  const originalWrite = output.write.bind(output)
  output.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => (String(chunk).includes("New password") ? originalWrite(chunk, ...(rest as [])) : true)) as typeof output.write
  try {
    const answer = await rl.question(`New password for ${email}: `)
    originalWrite("\n")
    return answer
  } finally {
    output.write = originalWrite
    rl.close()
  }
}

const password = await readPassword()
if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
  console.error(`The password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`)
  process.exit(1)
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
try {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, accounts: { where: { providerId: "credential" }, select: { id: true } } } })
  if (!user) {
    console.error(`No account with email ${email}.`)
    process.exit(1)
  }
  if (user.accounts.length === 0) {
    console.error(`${email} has no email/password credential (seed or placeholder user); nothing to reset.`)
    process.exit(1)
  }
  const hash = await hashPassword(password)
  if (!(await verifyPassword({ hash, password }))) throw new Error("The new hash did not verify; nothing was written.")
  const [, sessions] = await prisma.$transaction([
    prisma.account.update({ where: { id: user.accounts[0].id }, data: { password: hash } }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ])
  console.log(`Password updated for ${email} (${operator.target} database); ${sessions.count} session(s) revoked. Ask the person to sign in and change it.`)
} catch (error) {
  console.error("Could not reset the password:", error instanceof Error ? error.message.split("\n")[0] : String(error))
  process.exit(2)
} finally {
  await prisma.$disconnect()
}
