import { EMAIL_VERIFICATION_TOKEN_TTL_SECONDS } from "@/lib/auth/password-policy"
import { normalizeEmailVerificationUrl } from "@/lib/auth/reset-link"
import type { MailMessage } from "@/lib/mail/mailer"
import { greetingName } from "@/lib/mail/templates/display-name"
import { BRAND_NAME, renderHtml, renderText, type EmailContent } from "@/lib/mail/templates/render"

/**
 * The email-verification message (Phase 10.7), sent after sign-up, on a
 * sign-in attempt by an unconfirmed account when verification is required,
 * and when a signed-in person asks to confirm their address. One wording fits
 * all three: it asks the recipient to confirm the address and says to ignore
 * the message otherwise. Same rules as the reset template: the link appears
 * once in the HTML href and once in the text, never in the subject, and a
 * link that is not a well-formed `/verify-email#token=…` is refused.
 */

export const EMAIL_VERIFICATION_KIND = "email-verification"
export const EMAIL_VERIFICATION_SUBJECT = `Confirm your email for ${BRAND_NAME}`

export type EmailVerificationInput = { to: string; verifyUrl: string; name?: string | null }

export type VerificationTemplateResult = { ok: true; message: MailMessage } | { ok: false; reason: "invalid-verification-url" }

function lifetime(): string {
  const minutes = Math.round(EMAIL_VERIFICATION_TOKEN_TTL_SECONDS / 60)
  return minutes % 60 === 0 ? (minutes === 60 ? "1 hour" : `${minutes / 60} hours`) : `${minutes} minutes`
}

export function emailVerificationEmail(input: EmailVerificationInput): VerificationTemplateResult {
  const url = normalizeEmailVerificationUrl(input.verifyUrl)
  if (!url) return { ok: false, reason: "invalid-verification-url" }
  const content: EmailContent = {
    subject: EMAIL_VERIFICATION_SUBJECT,
    heading: "Confirm your email address",
    greetingName: greetingName(input.name),
    blocks: [
      { type: "paragraph", text: `Please confirm that this is the email address for your ${BRAND_NAME} account.` },
      { type: "action", label: "Confirm email", url },
      { type: "paragraph", text: `This link expires in ${lifetime()}.` },
      { type: "paragraph", text: `If you didn't create a ${BRAND_NAME} account or ask to confirm this address, you can ignore this email.` },
    ],
    footer: `You're receiving this because this address was used for a ${BRAND_NAME} account.`,
  }
  return { ok: true, message: { kind: EMAIL_VERIFICATION_KIND, to: input.to, subject: content.subject, text: renderText(content), html: renderHtml(content) } }
}
