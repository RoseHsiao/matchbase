import { AsyncLocalStorage } from "node:async_hooks"

import { CLIENT_IP_HEADER } from "@/lib/auth/client-ip"
import { buildEmailVerificationUrl } from "@/lib/auth/reset-link"
import { VERIFICATION_TOKEN_PATTERN } from "@/lib/auth/reset-token-fragment"
import { isFlagEnabled, resolveRuntimeEnvironment, type EnvLike, type RuntimeEnvironment } from "@/lib/env/runtime-environment"
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
  /** Verification mail is switched on (AUTH_EMAIL_VERIFICATION_ENABLED) and a transport can deliver it. */
  verificationMail: boolean
  /** AUTH_ALLOW_UNVERIFIED_SIGN_UP=true: the operator accepts open sign-up without email verification. */
  unverifiedRequested: boolean
  /**
   * A deployment (Production or Preview) accepts sign-up without verification
   * because both flags are set. Development's own unverified default is not
   * counted here.
   */
  unverifiedSignUp: boolean
  /** Why sign-up is refused although requested; never a secret. */
  refusal: string | null
}

export const SIGN_UP_FLAG = "AUTH_ALLOW_SIGN_UP"
export const UNVERIFIED_SIGN_UP_FLAG = "AUTH_ALLOW_UNVERIFIED_SIGN_UP"

/**
 * Whether public sign-up was ASKED for: AUTH_ALLOW_SIGN_UP when it has a
 * value (empty counts as unset), otherwise the development default (open).
 * An input to `accountPolicy`, not a decision; deliberately not exported.
 */
function signUpRequested(env: EnvLike): boolean {
  const explicit = env[SIGN_UP_FLAG]?.trim()
  if (explicit !== undefined && explicit !== "") return isFlagEnabled(explicit)
  return resolveRuntimeEnvironment(env) === "development"
}

/**
 * - Sign-up stays exactly as requested by the existing policy (closed outside
 *   development unless AUTH_ALLOW_SIGN_UP=true); nothing here opens it alone.
 * - Open sign-up **requires** verification whenever verification mail is on
 *   (AUTH_EMAIL_VERIFICATION_ENABLED plus a deliverable transport); the
 *   unverified flag never weakens that.
 * - On a deployment (Production, Preview) without verification mail, sign-up
 *   opens only when the operator sets BOTH AUTH_ALLOW_SIGN_UP=true and
 *   AUTH_ALLOW_UNVERIFIED_SIGN_UP=true. Either flag alone is refused, and the
 *   readiness check fails (the startup guard stops Production and Preview).
 *   Unverified accounts cannot recover their password themselves, and the
 *   sign-up endpoint then tells an existing address from a new one
 *   (docs/security/production-hardening.md, "Public sign-up without email
 *   verification").
 * - Development keeps the old behaviour (open, unverified) so the form stays
 *   usable without mail; the unverified flag is ignored there.
 * - With sign-up closed, verification is not required: the accounts are
 *   operator-created, and requiring it would lock out the existing operator
 *   ADMIN (emailVerified=false). With verification mail on, a signed-in
 *   person can still confirm their address (Phase 11 email reminders go only
 *   to confirmed addresses).
 */
export function accountPolicy(env: EnvLike): AccountPolicy {
  const environment = resolveRuntimeEnvironment(env)
  const requested = signUpRequested(env)
  const verificationMail = readMailEnv(env).emailVerification.enabled
  const unverifiedRequested = isFlagEnabled(env[UNVERIFIED_SIGN_UP_FLAG])
  const base = { environment, signUpRequested: requested, verificationMail, unverifiedRequested, unverifiedSignUp: false }
  const deployment = environment !== "development"
  if (!requested) {
    const refusal = deployment && unverifiedRequested ? `${UNVERIFIED_SIGN_UP_FLAG}=true is set without AUTH_ALLOW_SIGN_UP=true; both flags are required to open sign-up without email verification, so sign-up stays closed.` : null
    return { ...base, signUpOpen: false, requireEmailVerification: false, refusal }
  }
  if (verificationMail) return { ...base, signUpOpen: true, requireEmailVerification: true, refusal: null }
  if (!deployment) return { ...base, signUpOpen: true, requireEmailVerification: false, refusal: null }
  if (unverifiedRequested) return { ...base, signUpOpen: true, requireEmailVerification: false, unverifiedSignUp: true, refusal: null }
  return { ...base, signUpOpen: false, requireEmailVerification: false, refusal: `Public sign-up was requested (AUTH_ALLOW_SIGN_UP=true), but verification mail is not available (AUTH_EMAIL_VERIFICATION_ENABLED with a deliverable transport) and ${UNVERIFIED_SIGN_UP_FLAG}=true is not set; sign-up stays closed.` }
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

// CLIENT_IP_HEADER carries the IP the route derived (lib/auth/client-ip.ts); it is the only one Better Auth's limiter reads.
const FORWARDED_HEADERS = [CLIENT_IP_HEADER, "x-forwarded-for", "x-real-ip", "x-vercel-forwarded-for", "cf-connecting-ip", "user-agent", "cookie"]

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
