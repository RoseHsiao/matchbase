import type { Mailer, MailResult } from "@/lib/mail/mailer"

/**
 * The explicit no-send transport, used whenever mail is off or its
 * configuration was refused. It answers `disabled` with the reason, never
 * `sent`, so a caller can tell the person "email is not available" instead
 * of claiming a message is on its way.
 */
export function createDisabledMailer(reason = "Mail is disabled in this environment."): Mailer {
  const result: MailResult = { status: "disabled", transport: "disabled", reason }
  return {
    transport: "disabled",
    async send() {
      return result
    },
  }
}
