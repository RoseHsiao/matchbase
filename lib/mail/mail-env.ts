import { isFlagEnabled, resolveRuntimeEnvironment, type EnvLike, type RuntimeEnvironment } from "@/lib/env/runtime-environment"
import { isMailAddress } from "@/lib/mail/mailer"
import { readRecipientPolicy, type RecipientPolicy } from "@/lib/mail/recipient-policy"

/**
 * Mail configuration derived from the environment, kept pure like
 * lib/auth/auth-env.ts so every combination is unit-tested without a server.
 *
 * It never throws and never copies a secret into a message. A combination
 * that is unsafe or incomplete does not crash the process: the transport
 * falls back to `disabled` and the reason is reported as an `error` issue,
 * so nothing is sent and nothing pretends to be sent. Decisions:
 * docs/security/account-recovery.md.
 *
 * - `MAIL_TRANSPORT` is explicit. Unset means `disabled` in every
 *   environment; nothing is sent unless an operator chose a transport.
 * - `dev-outbox` exists only in local development.
 * - `resend` outside Production needs `MAIL_ALLOWED_RECIPIENTS`, so a
 *   Preview or a developer shell can only ever mail the people listed.
 *   In Production the allowlist is forbidden (it is a Preview setting that
 *   leaked) rather than silently narrowing who receives mail.
 * - The in-memory capture transport is not a value of `MAIL_TRANSPORT`:
 *   tests construct it directly, configuration can never select it.
 * - `AUTH_EMAIL_VERIFICATION_ENABLED` is the same kind of request for verification mail;
 *   a configured transport alone sends nothing to users.
 * - `AUTH_PASSWORD_RESET_ENABLED` is only a request. Recovery counts as
 *   enabled when a transport can deliver, and in Production only through
 *   Resend from a sending domain of our own. A Production Resend transport on
 *   Resend's shared test domain is refused outright, recovery or not.
 */

export const MAIL_TRANSPORTS = ["resend", "dev-outbox", "disabled"] as const
export type MailTransportName = (typeof MAIL_TRANSPORTS)[number]

export const PASSWORD_RESET_FLAG = "AUTH_PASSWORD_RESET_ENABLED"
export const EMAIL_VERIFICATION_FLAG = "AUTH_EMAIL_VERIFICATION_ENABLED"
export const DEFAULT_MAIL_DAILY_CAP = 100
export const MAX_MAIL_DAILY_CAP = 10_000

/** Resend's shared onboarding domain: it delivers only to the account owner and is never a Production sender. */
const RESEND_TEST_DOMAIN = "resend.dev"

export type MailIssue = { severity: "error" | "warning"; variable: string; message: string }

export type MailTransportConfig =
  | { kind: "disabled"; reason: string }
  | { kind: "dev-outbox"; from: string; replyTo?: string }
  | { kind: "resend"; from: string; replyTo?: string; apiKey: string; recipients: RecipientPolicy }

export type PasswordResetAvailability = { requested: boolean; enabled: true } | { requested: boolean; enabled: false; reason: string }

/** Same shape as recovery: an explicit request that counts only with a transport that can deliver. */
export type FeatureAvailability = PasswordResetAvailability

export type MailEnvConfig = {
  environment: RuntimeEnvironment
  transport: MailTransportConfig
  passwordReset: PasswordResetAvailability
  /**
   * Verification mail (Phase 10.7): confirmation links, the Watchlist "Send confirmation link"
   * action and, through accountPolicy, required verification for open sign-up. Configuring a
   * transport alone does not turn it on.
   */
  emailVerification: FeatureAvailability
  dailyCap: number
  /** Never contains a secret value or a recipient address. */
  issues: MailIssue[]
}

/**
 * A sender as `address` or `Display Name <address>`. Line breaks are refused
 * outright so a variable can never inject a header.
 */
export function parseSender(value: string | undefined): { address: string; formatted: string } | null {
  const raw = value?.trim() ?? ""
  if (!raw || /[\r\n]/.test(raw)) return null
  const named = /^([^<>"\r\n]{1,100}?)\s*<([^<>\s]+)>$/.exec(raw)
  if (named) return isMailAddress(named[2]) ? { address: named[2].toLowerCase(), formatted: `${named[1].trim()} <${named[2]}>` } : null
  return isMailAddress(raw) ? { address: raw.toLowerCase(), formatted: raw } : null
}

export function domainOf(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1).toLowerCase()
}

function isResendTestDomain(address: string): boolean {
  const domain = domainOf(address)
  return domain === RESEND_TEST_DOMAIN || domain.endsWith(`.${RESEND_TEST_DOMAIN}`)
}

function readDailyCap(env: EnvLike, issues: MailIssue[]): number {
  const raw = env.MAIL_DAILY_CAP?.trim()
  if (!raw) return DEFAULT_MAIL_DAILY_CAP
  const value = Number(raw)
  if (Number.isInteger(value) && value >= 1 && value <= MAX_MAIL_DAILY_CAP) return value
  issues.push({ severity: "warning", variable: "MAIL_DAILY_CAP", message: `MAIL_DAILY_CAP must be a whole number from 1 to ${MAX_MAIL_DAILY_CAP}; using ${DEFAULT_MAIL_DAILY_CAP}.` })
  return DEFAULT_MAIL_DAILY_CAP
}

function readTransport(env: EnvLike, environment: RuntimeEnvironment, issues: MailIssue[]): MailTransportConfig {
  const fail = (variable: string, message: string): MailTransportConfig => {
    issues.push({ severity: "error", variable, message })
    return { kind: "disabled", reason: message }
  }

  const name = env.MAIL_TRANSPORT?.trim().toLowerCase() ?? ""
  if (name === "" || name === "disabled") {
    // Only a stray allowlist is worth mentioning; with nothing configured, mail is simply off.
    if (environment === "production" && env.MAIL_ALLOWED_RECIPIENTS?.trim()) {
      issues.push({ severity: "warning", variable: "MAIL_ALLOWED_RECIPIENTS", message: "MAIL_ALLOWED_RECIPIENTS is a Preview setting and has no place in Production." })
    }
    return { kind: "disabled", reason: "MAIL_TRANSPORT is not set; no mail is sent." }
  }
  if (!(MAIL_TRANSPORTS as readonly string[]).includes(name)) {
    return fail("MAIL_TRANSPORT", `MAIL_TRANSPORT must be one of ${MAIL_TRANSPORTS.join(", ")}; mail is disabled.`)
  }

  const sender = parseSender(env.MAIL_FROM)
  if (!sender) return fail("MAIL_FROM", "MAIL_FROM must be an address or `Name <address>` on one line; mail is disabled.")
  const replyToRaw = env.MAIL_REPLY_TO?.trim()
  if (replyToRaw && (!isMailAddress(replyToRaw) || /[\r\n]/.test(replyToRaw))) return fail("MAIL_REPLY_TO", "MAIL_REPLY_TO must be a single address; mail is disabled.")
  const replyTo = replyToRaw || undefined

  if (name === "dev-outbox") {
    if (environment !== "development") return fail("MAIL_TRANSPORT", `MAIL_TRANSPORT=dev-outbox is refused in the ${environment} environment; mail is disabled.`)
    return { kind: "dev-outbox", from: sender.formatted, replyTo }
  }

  // resend
  const apiKey = env.RESEND_API_KEY?.trim() ?? ""
  if (!/^re_[A-Za-z0-9_-]{8,}$/.test(apiKey)) return fail("RESEND_API_KEY", "RESEND_API_KEY is missing or not shaped like a Resend API key; mail is disabled.")
  const allowlist = readRecipientPolicy(env.MAIL_ALLOWED_RECIPIENTS)
  if (!allowlist.ok) return fail("MAIL_ALLOWED_RECIPIENTS", allowlist.message)
  if (environment === "production") {
    if (allowlist.policy.mode === "allowlist") return fail("MAIL_ALLOWED_RECIPIENTS", "MAIL_ALLOWED_RECIPIENTS is a Preview setting and is refused in Production; mail is disabled.")
    if (isResendTestDomain(sender.address)) return fail("MAIL_FROM", "MAIL_FROM in Production must be on a sending domain of our own, not Resend's shared test domain; mail is disabled.")
    return { kind: "resend", from: sender.formatted, replyTo, apiKey, recipients: allowlist.policy }
  }
  if (allowlist.policy.mode !== "allowlist") {
    return fail("MAIL_ALLOWED_RECIPIENTS", `MAIL_TRANSPORT=resend in the ${environment} environment requires MAIL_ALLOWED_RECIPIENTS; mail is disabled.`)
  }
  return { kind: "resend", from: sender.formatted, replyTo, apiKey, recipients: allowlist.policy }
}

function passwordResetAvailability(env: EnvLike, environment: RuntimeEnvironment, transport: MailTransportConfig, issues: MailIssue[]): PasswordResetAvailability {
  const requested = isFlagEnabled(env[PASSWORD_RESET_FLAG])
  if (!requested) return { requested, enabled: false, reason: `${PASSWORD_RESET_FLAG} is not enabled.` }
  const refuse = (reason: string): PasswordResetAvailability => {
    issues.push({ severity: "error", variable: PASSWORD_RESET_FLAG, message: reason })
    return { requested, enabled: false, reason }
  }
  if (transport.kind === "disabled") return refuse(`${PASSWORD_RESET_FLAG} is set but no mail transport can deliver; password recovery stays disabled.`)
  if (environment === "production") {
    if (transport.kind !== "resend") return refuse(`Password recovery in Production requires MAIL_TRANSPORT=resend; it stays disabled.`)
    const sender = parseSender(transport.from)
    if (!sender || isResendTestDomain(sender.address)) {
      return refuse("Password recovery in Production requires MAIL_FROM on a verified sending domain of our own; it stays disabled.")
    }
  }
  return { requested, enabled: true }
}

/**
 * Environment overrides that switch every mail feature off, for auth instances
 * built by operator commands (scripts/account-create.mts). An operator shell
 * may carry a deployment's mail variables; an operator action must never send
 * mail because of them. Secret values such as RESEND_API_KEY are left in place
 * so log redaction still knows them.
 */
export const MAIL_OFF_ENV: Readonly<Record<string, string | undefined>> = {
  MAIL_TRANSPORT: "disabled",
  MAIL_ALLOWED_RECIPIENTS: undefined,
  AUTH_PASSWORD_RESET_ENABLED: undefined,
  AUTH_EMAIL_VERIFICATION_ENABLED: undefined,
}

function emailVerificationAvailability(env: EnvLike, transport: MailTransportConfig, issues: MailIssue[]): FeatureAvailability {
  const requested = isFlagEnabled(env[EMAIL_VERIFICATION_FLAG])
  if (!requested) return { requested, enabled: false, reason: `${EMAIL_VERIFICATION_FLAG} is not enabled.` }
  if (transport.kind === "disabled") {
    const reason = `${EMAIL_VERIFICATION_FLAG} is set but no mail transport can deliver; verification mail stays disabled.`
    issues.push({ severity: "error", variable: EMAIL_VERIFICATION_FLAG, message: reason })
    return { requested, enabled: false, reason }
  }
  // Production's transport is Resend from an own domain by construction (readTransport refuses anything else).
  return { requested, enabled: true }
}

export function readMailEnv(env: EnvLike): MailEnvConfig {
  const environment = resolveRuntimeEnvironment(env)
  const issues: MailIssue[] = []
  const transport = readTransport(env, environment, issues)
  const dailyCap = readDailyCap(env, issues)
  const passwordReset = passwordResetAvailability(env, environment, transport, issues)
  const emailVerification = emailVerificationAvailability(env, transport, issues)
  return { environment, transport, passwordReset, emailVerification, dailyCap, issues }
}
