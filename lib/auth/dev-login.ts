import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy"
import { isFlagEnabled, resolveRuntimeEnvironment, type EnvLike } from "@/lib/env/runtime-environment"

/**
 * Policy for the optional local-development quick sign-in: two accounts, a
 * USER and an ADMIN, that authenticate through Better Auth exactly like any
 * other account. This module only decides whether the feature may exist in
 * the current process and reads the credentials from the environment; it
 * is pure so the refusal rules are unit-tested.
 *
 * It can be enabled only when all of these hold:
 * - the runtime environment is `development` (never Vercel production or
 *   preview, never NODE_ENV=production);
 * - MATCHBASE_DEV_LOGIN is a true value;
 * - both accounts have an email and a password that meets the normal policy.
 */

export const DEV_LOGIN_FLAG = "MATCHBASE_DEV_LOGIN"

export type DevRole = "USER" | "ADMIN"

export type DevAccount = { role: DevRole; name: string; email: string; password: string }

export type DevLoginPolicy = { enabled: true; accounts: readonly [DevAccount, DevAccount] } | { enabled: false; reason: string }

const VARIABLES: Record<DevRole, { email: string; password: string; name: string }> = {
  USER: { email: "MATCHBASE_DEV_USER_EMAIL", password: "MATCHBASE_DEV_USER_PASSWORD", name: "Dev User" },
  ADMIN: { email: "MATCHBASE_DEV_ADMIN_EMAIL", password: "MATCHBASE_DEV_ADMIN_PASSWORD", name: "Dev Admin" },
}

function readAccount(env: EnvLike, role: DevRole): DevAccount | string {
  const names = VARIABLES[role]
  const email = env[names.email]?.trim().toLowerCase() ?? ""
  const password = env[names.password] ?? ""
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return `${names.email} must be a valid email address.`
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return `${names.password} must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`
  }
  return { role, name: names.name, email, password }
}

export function resolveDevLogin(env: EnvLike): DevLoginPolicy {
  const environment = resolveRuntimeEnvironment(env)
  if (environment !== "development") {
    return { enabled: false, reason: `Development quick sign-in is refused in the ${environment} environment.` }
  }
  if (!isFlagEnabled(env[DEV_LOGIN_FLAG])) return { enabled: false, reason: `${DEV_LOGIN_FLAG} is not enabled.` }
  const user = readAccount(env, "USER")
  if (typeof user === "string") return { enabled: false, reason: user }
  const admin = readAccount(env, "ADMIN")
  if (typeof admin === "string") return { enabled: false, reason: admin }
  if (user.email === admin.email) return { enabled: false, reason: "The development USER and ADMIN accounts must use different email addresses." }
  return { enabled: true, accounts: [user, admin] }
}

/** What the sign-in page may show: roles and emails, never passwords. */
export function describeDevAccounts(policy: DevLoginPolicy): { role: DevRole; email: string }[] {
  return policy.enabled ? policy.accounts.map(({ role, email }) => ({ role, email })) : []
}
