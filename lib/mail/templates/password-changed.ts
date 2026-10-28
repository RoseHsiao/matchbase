import type { MailMessage } from "@/lib/mail/mailer"
import { greetingName } from "@/lib/mail/templates/display-name"
import { BRAND_NAME, renderHtml, renderText, type EmailContent } from "@/lib/mail/templates/render"

/**
 * The security notice sent after a password change through the self-service
 * reset (wired in 10.3). It deliberately carries no link at all: no reset
 * token, no sign-in URL, nothing a phishing copy could imitate as "click
 * here". The advice names only what exists in the product: the sign-in page's
 * "Forgot password?" flow, which is available wherever this notice is sent
 * (both ship behind the same switch). There is no support address or
 * security contact yet, so none is mentioned.
 *
 * The operator command `account:password` does not send this notice; the
 * operator talks to the person directly.
 */

export const PASSWORD_CHANGED_KIND = "password-changed"
export const PASSWORD_CHANGED_SUBJECT = `Your ${BRAND_NAME} password was changed`

export type PasswordChangedEmailInput = {
  to: string
  name?: string | null
}

export function passwordChangedEmail(input: PasswordChangedEmailInput): MailMessage {
  const content: EmailContent = {
    subject: PASSWORD_CHANGED_SUBJECT,
    heading: "Your password was changed",
    greetingName: greetingName(input.name),
    blocks: [
      { type: "paragraph", text: `The password for your ${BRAND_NAME} account was just changed. If you made this change, no action is needed.` },
      {
        type: "paragraph",
        text: `If you didn't make this change, someone else may have access to your account. Go to the ${BRAND_NAME} sign-in page, choose "Forgot password?" to set a new password straight away, and check the security of this email account, since reset links are sent here.`,
      },
    ],
    footer: `You're receiving this security notice because the password for your ${BRAND_NAME} account was changed.`,
  }
  return { kind: PASSWORD_CHANGED_KIND, to: input.to, subject: content.subject, text: renderText(content), html: renderHtml(content) }
}
