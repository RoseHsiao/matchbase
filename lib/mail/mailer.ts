/**
 * The provider-neutral mail contract. Everything that sends mail (password
 * recovery now, email verification in 10B, match reminders in Phase 11)
 * builds a `MailMessage` and calls `Mailer.send`; nothing outside
 * lib/mail/transports knows which provider is behind it.
 *
 * `send` never throws. Every outcome is a `MailResult`:
 * - `sent`: a transport accepted the message (for Resend: the API answered 2xx);
 * - `suppressed`: deliberately not sent to this recipient (Preview allowlist);
 * - `disabled`: mail is switched off in this environment;
 * - `failed`: the transport tried and could not; `category` says why in
 *   terms the caller can act on, `retryable` whether trying later may help.
 * A result carries no recipient, body, token, API key or provider response
 * text, so it can be logged or stored as it is.
 */

export type MailTransportKind = "resend" | "dev-outbox" | "disabled" | "capture"

export type MailMessage = {
  /** A short slug saying what the message is for (`password-reset`, `match-reminder`, ...). Logged; never personal. */
  kind: string
  /** One recipient address per message: no lists, so one person's address never reaches another. */
  to: string
  subject: string
  text: string
  html?: string
  /** Lets a provider drop a repeated send of the same logical message (Phase 11 retries). Opaque, never personal. */
  idempotencyKey?: string
}

export type MailFailureCategory =
  /** No answer within the time budget. */
  | "timeout"
  /** The request never completed: DNS, connection, TLS. */
  | "network"
  /** The provider refused our credentials or sender (401/403): an operator must fix configuration. */
  | "auth-config"
  /** The provider asked us to slow down (429). */
  | "rate-limit"
  /** The provider rejected this request (other 4xx). */
  | "provider-4xx"
  /** The provider failed (5xx). */
  | "provider-5xx"
  /** The transport failed on our side without reaching a provider (the dev outbox could not write its file). */
  | "transport-error"
  /** Refused before any transport saw it: malformed address, header characters, oversized content. */
  | "invalid-message"

export type MailResult =
  | { status: "sent"; transport: MailTransportKind; providerMessageId?: string }
  | { status: "suppressed"; transport: MailTransportKind; reason: "recipient-not-allowlisted" }
  | { status: "disabled"; transport: MailTransportKind; reason: string }
  | { status: "failed"; transport: MailTransportKind; category: MailFailureCategory; retryable: boolean; httpStatus?: number }

export interface Mailer {
  readonly transport: MailTransportKind
  send(message: MailMessage): Promise<MailResult>
}

const ADDRESS = /^[^\s@<>"(),;:]+@[^\s@<>"(),;:]+\.[^\s@<>"(),;:]+$/

/** True for a single bare address: no display name, no list, no header characters. */
export function isMailAddress(value: string): boolean {
  return value.length <= 254 && ADDRESS.test(value)
}

export const MAX_SUBJECT_LENGTH = 200
/** Generous for transactional mail; anything bigger is a bug, not a message. */
export const MAX_BODY_LENGTH = 200_000

/** Why a message cannot be sent, or null when it is well formed. The reason never quotes the message. */
export function invalidMessageReason(message: MailMessage): string | null {
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(message.kind)) return "kind must be a short lowercase slug"
  if (!isMailAddress(message.to)) return "recipient is not a single plain address"
  if (!message.subject.trim() || message.subject.length > MAX_SUBJECT_LENGTH || /[\r\n]/.test(message.subject)) return "subject must be one non-empty line"
  if (!message.text.trim()) return "a plain-text body is required"
  if (message.text.length > MAX_BODY_LENGTH || (message.html?.length ?? 0) > MAX_BODY_LENGTH) return "body is too large"
  if (message.idempotencyKey !== undefined && !/^[A-Za-z0-9:_-]{1,256}$/.test(message.idempotencyKey)) return "idempotency key has unexpected characters"
  return null
}

export function invalidMessageResult(transport: MailTransportKind): MailResult {
  return { status: "failed", transport, category: "invalid-message", retryable: false }
}

/**
 * One log line for an outcome: kind, transport, status, category, HTTP
 * status and provider id. Callers log this instead of the message, so the
 * recipient, the body and anything inside it (a reset link) stay out of logs.
 */
export function describeMailResult(kind: string, result: MailResult): string {
  const parts = [`kind=${kind}`, `transport=${result.transport}`, `status=${result.status}`]
  if (result.status === "failed") {
    parts.push(`category=${result.category}`, `retryable=${result.retryable}`)
    if (result.httpStatus !== undefined) parts.push(`http=${result.httpStatus}`)
  }
  if (result.status === "suppressed") parts.push(`reason=${result.reason}`)
  if (result.status === "sent" && result.providerMessageId) parts.push(`id=${result.providerMessageId}`)
  return `[mail] ${parts.join(" ")}`
}
