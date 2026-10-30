import { randomBytes } from "node:crypto"

import { PrismaPg } from "@prisma/adapter-pg"

import { createAuth } from "../lib/auth/create-auth"
import { MAIL_OFF_ENV } from "../lib/mail/mail-env"
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../lib/auth/password-policy"
import { operatorPolicy } from "../lib/env/runtime-environment"
import { PrismaClient } from "../lib/generated/prisma/client"
import { readOperatorPassword } from "./shared/read-password"

/**
 * Operator-only account creation for a deployment with closed sign-up
 * (Phase 9.3A, docs/security/production-hardening.md "First account").
 *
 *   npm run account:create -- someone@example.com --name "Someone"
 *
 * The account is created through Better Auth's own sign-up API on a
 * server-side instance whose only difference from the application's is that
 * sign-up is allowed for this one call: the same validation, the same scrypt
 * hash, the same User and Account rows. The role stays USER; promotion is a
 * separate step (`npm run admin:role -- grant`). The session Better Auth
 * opens on sign-up is deleted immediately, so no session exists for the new
 * account until the person signs in.
 *
 * The password comes from MATCHBASE_NEW_PASSWORD for this invocation or a
 * hidden prompt; it is never printed. The auth secret is only needed to sign
 * that discarded session, so a throwaway value is used when the shell has
 * none: nothing derived from it is kept. Refused against a production-labelled
 * database without MATCHBASE_OPERATOR_TARGET=production.
 */

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file)
  } catch {
    // optional
  }
}

const args = process.argv.slice(2)
const email = args[0]?.trim().toLowerCase() ?? ""
const nameIndex = args.indexOf("--name")
const name = (nameIndex >= 0 ? args[nameIndex + 1] : undefined)?.trim() || email.split("@")[0]
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.startsWith("--")) {
  console.error('Usage: npm run account:create -- <email> [--name "Display name"]   (password from MATCHBASE_NEW_PASSWORD or a hidden prompt)')
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

const password = await readOperatorPassword("MATCHBASE_NEW_PASSWORD", `Password for ${email}: `)
if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
  console.error(`The password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`)
  process.exit(1)
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }), transactionOptions: { timeout: 30_000, maxWait: 10_000 } })
try {
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    console.error(`An account with email ${email} already exists. Use npm run account:password to reset its password.`)
    process.exit(1)
  }
  const secret = process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_SECRET.length >= 32 ? process.env.BETTER_AUTH_SECRET : randomBytes(32).toString("base64")
  const auth = createAuth({
    prisma,
    // Operator context: the process environment for redaction, sign-up allowed for this call only, never a deployment
    // base URL, and every mail feature off whatever the shell carries: creating an account never sends email.
    env: { ...process.env, ...MAIL_OFF_ENV, BETTER_AUTH_SECRET: secret, AUTH_ALLOW_SIGN_UP: "true", NODE_ENV: "development", VERCEL_ENV: undefined, BETTER_AUTH_URL: undefined },
  })
  const result = await auth.api.signUpEmail({ body: { name, email, password } })
  const revoked = await prisma.session.deleteMany({ where: { userId: result.user.id } })
  const row = await prisma.user.findUniqueOrThrow({ where: { id: result.user.id }, select: { role: true, accounts: { select: { providerId: true } } } })
  console.log(`Created ${email} (${operator.target} database): role ${row.role}, credential ${row.accounts.map((a) => a.providerId).join(",") || "none"}, ${revoked.count} bootstrap session(s) discarded.`)
  console.log("Next: hand over the password out of band; to make this account an administrator run: npm run admin:role -- grant " + email)
} catch (error) {
  const message = error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : String(error)
  console.error("Could not create the account:", message)
  process.exit(2)
} finally {
  await prisma.$disconnect()
}
