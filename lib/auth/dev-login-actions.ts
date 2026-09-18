"use server"

import { getAuth } from "@/lib/auth/auth"
import { provisionDevAccounts } from "@/lib/auth/dev-accounts"
import { resolveDevLogin, type DevRole } from "@/lib/auth/dev-login"
import { db } from "@/lib/data/db"
import { logServerError } from "@/lib/logging/server-log"

/**
 * Local-development quick sign-in. Re-checks the policy on every call (the
 * button only exists when it passed at render time, but the action is the
 * boundary), makes sure the two development accounts exist, then signs in
 * through Better Auth's real sign-in endpoint. The `nextCookies` plugin on
 * the application instance forwards the Set-Cookie header to the browser,
 * so the session is an ordinary database session; nothing about the
 * Viewer, the guards or the cookie is special-cased.
 */

export type DevQuickSignInResult = { ok: true } | { ok: false; error: string }

export async function devQuickSignIn(role: DevRole): Promise<DevQuickSignInResult> {
  const policy = resolveDevLogin(process.env)
  if (!policy.enabled) return { ok: false, error: policy.reason }
  const account = policy.accounts.find((candidate) => candidate.role === role)
  if (!account) return { ok: false, error: "Unknown development role." }
  try {
    const auth = getAuth()
    await provisionDevAccounts({ auth, prisma: db }, [account])
    await auth.api.signInEmail({ body: { email: account.email, password: account.password } })
    return { ok: true }
  } catch (error) {
    logServerError("dev-login", error)
    return { ok: false, error: "Development quick sign-in failed; see the server log." }
  }
}
