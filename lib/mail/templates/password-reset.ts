import { PASSWORD_RESET_TOKEN_TTL_SECONDS } from "@/lib/auth/password-policy"
import { normalizePasswordResetUrl } from "@/lib/auth/reset-link"
import type { MailMessage } from "@/lib/mail/mailer"
import { greetingName } from "@/lib/mail/templates/display-name"
import { BRAND_NAME, renderHtml, renderText, type EmailContent } from "@/lib/mail/templates/render"

/**
 * The password-reset email. The caller (Better Auth's `sendResetPassword`,
 * from 10.3) passes the recipient, the link from `buildPasswordResetUrl` and
 * optionally the account's display name; nothing else is needed or accepted.
 *
 * The link is the only sensitive value. It appears exactly twice, as the
 * HTML button's href and as the full URL in the plain-text part, and never
 * in the subject. A link that is not a well-formed reset link (see
 * lib/auth/reset-link.ts) is refused rather than mailed.
 */

export const PASSWORD_RESET_KIND = "password-reset"
export const PASSWORD_RESET_SUBJECT = `Reset your ${BRAND_NAME} password`

export type PasswordResetEmailInput = {
  to: string
  resetUrl: string
  name?: string | null
}

export type TemplateResult = { ok: true; message: MailMessage } | { ok: false; reason: "invalid-reset-url" }

function lifetime(): string {
  const minutes = Math.round(PASSWORD_RESET_TOKEN_TTL_SECONDS / 60)
  return minutes === 1 ? "1 minute" : `${minutes} minutes`
}

export function passwordResetEmail(input: PasswordResetEmailInput): TemplateResult {
  const url = normalizePasswordResetUrl(input.resetUrl)
  if (!url) return { ok: false, reason: "invalid-reset-url" }
  const content: EmailContent = {
    subject: PASSWORD_RESET_SUBJECT,
    heading: "Reset your password",
    greetingName: greetingName(input.name),
    blocks: [
      { type: "paragraph", text: `We received a request to reset the password for your ${BRAND_NAME} account. To choose a new password, use the link below.` },
      { type: "action", label: "Reset password", url },
      { type: "paragraph", text: `This link expires in ${lifetime()} and can be used once.` },
      { type: "paragraph", text: "If you didn't request this, you can ignore this email. Your password stays the same unless you choose a new one with this link." },
    ],
    footer: `You're receiving this because a password reset was requested for your ${BRAND_NAME} account.`,
  }
  return { ok: true, message: { kind: PASSWORD_RESET_KIND, to: input.to, subject: content.subject, text: renderText(content), html: renderHtml(content) } }
}
