import { AsyncLocalStorage } from "node:async_hooks"

import { isSignUpAllowed } from "@/lib/auth/auth-env"
import { buildEmailVerificationUrl } from "@/lib/auth/reset-link"
import { VERIFICATION_TOKEN_PATTERN } from "@/lib/auth/reset-token-fragment"
import { resolveRuntimeEnvironment, type EnvLike, type RuntimeEnvironment } from "@/lib/env/runtime-environment"
import { deliverAndLog } from "@/lib/mail/deliver"
import { readMailEnv } from "@/lib/mail/mail-env"
import type { Mailer } from "@/lib/mail/mailer"
import { emailVerificationEmail } from "@/lib/mail/templates/email-verification"

/**
 * Email verification (Phase 10.7) on Better Auth's own token lifecycle:
 * Better Auth signs a short-lived HS256 token (`emailVerification.expiresIn`),
 * checks it, and flips `User.emailVerified`. Nothing here issues or stores a
 * token. Decisions: docs/security/account-recovery.md, "Email verification".
 */

// ---------------------------------------------------------------------------
// Account policy: who may sign up, and whether verification is required
// ---------------------------------------------------------------------------

export type AccountPolicy = {
  environment: RuntimeEnvironment
  /** AUTH_ALLOW_SIGN_UP (or the development default) asked for public sign-up. */
  signUpRequested: boolean
  /** Sign-up is actually accepted. */
  signUpOpen: boolean
  /** Unconfirmed accounts cannot sign in (Better Auth `requireEmailVerification`). */
  requireEmailVerification: boolean
  /** Verification mail can be sent (a transport can deliver). */
  verificationMail: boolean
  /** Why sign-up is refused although requested; never a secret. */
  refusal: string | null
}

/**
 * - Sign-up stays exactly as requested by the existing policy (closed outside
 *   development unless AUTH_ALLOW_SIGN_UP=true); nothing here opens it.
 * - Open sign-up **requires** verification whenever mail can be delivered.
 * - Outside development, open sign-up without a deliverable transport is
 *   refused: an account nobody can verify or recover is not created.
 *   Development keeps the old behaviour (open, unverified) so the form stays
 *   usable without mail.
 * - With sign-up closed, verification is not required: the accounts are
 *   operator-created, and requiring it would lock out the existing operator
 *   ADMIN (emailVerified=false). Verification mail is still available to a
 *   signed-in person who wants to confirm their address (Phase 11 email
 *   reminders go only to confirmed addresses).
 */
export function accountPolicy(env: EnvLike): AccountPolicy {
  const environment = resolveRuntimeEnvironment(env)
  const signUpRequested = isSignUpAllowed(env)
  const verificationMail = readMailEnv(env).transport.kind !== "disabled"
  if (!signUpRequested) return { environment, signUpRequested, signUpOpen: false, requireEmailVerification: false, verificationMail, refusal: null }
  if (verificationMail) return { environment, signUpRequested, signUpOpen: true, requireEmailVerification: true, verificationMail, refusal: null }
  if (environment === "development") return { environment, signUpRequested, signUpOpen: true, requireEmailVerification: false, verificationMail, refusal: null }
  return { environment, signUpRequested, signUpOpen: false, requireEmailVerification: false, verificationMail, refusal: "Public sign-up was requested, but no mail transport can deliver verification email; sign-up stays closed." }
}

// ---------------------------------------------------------------------------
// Sending: Better Auth's sendVerificationEmail hook
// ---------------------------------------------------------------------------

export type VerificationDeps = {
  mailer: Mailer
  baseURL: string | undefined
  background?: (task: Promise<unknown>) => void
  log?: (line: string) => void
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

export function createVerificationHooks(deps: VerificationDeps) {
  const log = deps.log ?? ((line: string) => console.info(line))

  /**
   * Mails MatchBase's own `/verify-email#token=…` link; Better Auth's `url`
   * (a GET with the token in the query string) is never sent. Runs in the
   * background where the host supports it, so the unauthenticated
   * `/send-verification-email` answers alike for every address.
   */
  async function sendVerificationEmail({ user, url, token }: { user: { email: string; name?: string | null }; url: string; token: string }): Promise<void> {
    const origin = deps.baseURL ?? originOf(url)
    const verifyUrl = origin ? buildEmailVerificationUrl(origin, token) : null
    const rendered = verifyUrl ? emailVerificationEmail({ to: user.email, verifyUrl, name: user.name }) : null
    if (!rendered?.ok) {
      log("[auth] verification link could not be built from the configured base URL; no mail sent")
      return
    }
    const task = deliverAndLog(deps.mailer, rendered.message, log).then(() => undefined)
    if (deps.background) deps.background(task)
    else await task
  }

  return { sendVerificationEmail }
}

// ---------------------------------------------------------------------------
// Consuming: POST bridge to Better Auth's GET /verify-email
// ---------------------------------------------------------------------------

/**
 * Better Auth verifies with `GET /verify-email?token=…`, which would put the
 * token in platform request logs. MatchBase blocks that GET at its route
 * boundary and offers `POST /api/auth/verify-email` with `{ token }` in the
 * body instead. The bridge hands Better Auth the same GET as an in-process
 * Request, so its rate limiter, token check and update all run unchanged.
 *
 * Better Auth answers a replayed token for an already-confirmed address with
 * the same success as the first use. To tell them apart without a second
 * token store, the bridge runs the call in an AsyncLocalStorage scope that
 * `afterEmailVerification` marks: the first use reports `verified`, any
 * later use `TOKEN_ALREADY_USED`. Auto sign-in after verification is off, so
 * a token never creates a session, first use or replay.
 */

const verificationScope = new AsyncLocalStorage<{ verified: boolean }>()

/** Better Auth's `afterEmailVerification` hook: records that this request changed the account. */
export function markEmailVerifiedInRequest(): void {
  const scope = verificationScope.getStore()
  if (scope) scope.verified = true
}

export type VerifyEmailResult = { status: 200; body: { status: "verified" } } | { status: 400 | 429; body: { code: "INVALID_TOKEN" | "TOKEN_EXPIRED" | "TOKEN_ALREADY_USED" | "RATE_LIMITED" } }

const FORWARDED_HEADERS = ["x-forwarded-for", "x-real-ip", "x-vercel-forwarded-for", "cf-connecting-ip", "user-agent", "cookie"]

export async function verifyEmailToken(request: Request, handle: (request: Request) => Promise<Response>): Promise<VerifyEmailResult> {
  let token: unknown
  try {
    token = ((await request.json()) as { token?: unknown } | null)?.token
  } catch {
    token = undefined
  }
  if (typeof token !== "string" || !VERIFICATION_TOKEN_PATTERN.test(token)) return { status: 400, body: { code: "INVALID_TOKEN" } }

  const target = new URL(request.url)
  target.search = new URLSearchParams({ token }).toString()
  const headers = new Headers()
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  const scope = { verified: false }
  const response = await verificationScope.run(scope, () => handle(new Request(target, { method: "GET", headers })))
  if (response.status === 429) return { status: 429, body: { code: "RATE_LIMITED" } }
  if (response.ok) return scope.verified ? { status: 200, body: { status: "verified" } } : { status: 400, body: { code: "TOKEN_ALREADY_USED" } }
  const code = ((await response.json().catch(() => null)) as { code?: string } | null)?.code
  return { status: 400, body: { code: code === "TOKEN_EXPIRED" ? "TOKEN_EXPIRED" : "INVALID_TOKEN" } }
}
