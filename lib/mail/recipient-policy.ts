import { isMailAddress, type Mailer, type MailMessage, type MailResult } from "@/lib/mail/mailer"

/**
 * Who a non-Production Resend transport may write to. Preview and local
 * shells run against copies of real data, so they deliver only to the exact
 * addresses an operator listed in MAIL_ALLOWED_RECIPIENTS (comma or
 * whitespace separated, compared case-insensitively). Anything else is
 * answered with a typed `suppressed` result; the address is never logged
 * or echoed back.
 *
 * Exact addresses only, no domains or wildcards: a whole-domain entry would
 * reach every seeded or imported account on that domain.
 */

export type RecipientPolicy = { mode: "all" } | { mode: "allowlist"; recipients: ReadonlySet<string> }

export const MAX_ALLOWED_RECIPIENTS = 20

export function normalizeRecipient(address: string): string {
  return address.trim().toLowerCase()
}

/** Parses the variable. Unset or blank means no allowlist (`all`); the caller decides whether that is acceptable. */
export function readRecipientPolicy(value: string | undefined): { ok: true; policy: RecipientPolicy } | { ok: false; message: string } {
  const entries = (value ?? "").split(/[\s,]+/).map(normalizeRecipient).filter(Boolean)
  if (entries.length === 0) return { ok: true, policy: { mode: "all" } }
  if (entries.length > MAX_ALLOWED_RECIPIENTS) return { ok: false, message: `MAIL_ALLOWED_RECIPIENTS lists more than ${MAX_ALLOWED_RECIPIENTS} addresses; mail is disabled.` }
  // The count of bad entries is reported, never the entries themselves.
  const invalid = entries.filter((entry) => !isMailAddress(entry)).length
  if (invalid > 0) return { ok: false, message: `MAIL_ALLOWED_RECIPIENTS has ${invalid} entr${invalid === 1 ? "y that is not" : "ies that are not"} a plain email address; mail is disabled.` }
  return { ok: true, policy: { mode: "allowlist", recipients: new Set(entries) } }
}

export function isRecipientAllowed(policy: RecipientPolicy, address: string): boolean {
  return policy.mode === "all" || policy.recipients.has(normalizeRecipient(address))
}

/** Wraps a mailer so it only delivers to allowed recipients. With `all`, the mailer is returned as is. */
export function withRecipientPolicy(mailer: Mailer, policy: RecipientPolicy): Mailer {
  if (policy.mode === "all") return mailer
  return {
    transport: mailer.transport,
    async send(message: MailMessage): Promise<MailResult> {
      if (!isRecipientAllowed(policy, message.to)) return { status: "suppressed", transport: mailer.transport, reason: "recipient-not-allowlisted" }
      return mailer.send(message)
    },
  }
}
