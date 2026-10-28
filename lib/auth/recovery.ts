import { buildPasswordResetUrl } from "@/lib/auth/reset-link"
import { deliverAndLog } from "@/lib/mail/deliver"
import type { Mailer } from "@/lib/mail/mailer"
import { passwordChangedEmail } from "@/lib/mail/templates/password-changed"
import { passwordResetEmail } from "@/lib/mail/templates/password-reset"
import type { Prisma } from "@/lib/generated/prisma/client"

/**
 * Self-service password recovery, as the two Better Auth hooks it needs
 * (`emailAndPassword.sendResetPassword` and `onPasswordReset`), written
 * against injected dependencies so the database tests run them with a
 * capture mailer. Better Auth owns the token: it generates it, stores it
 * (hashed, see create-auth.ts), expires it and consumes it once. Nothing
 * here creates, stores or checks a token.
 *
 * What the hooks add:
 * - the emailed link is MatchBase's own `/reset-password#token=…`
 *   (`buildPasswordResetUrl`), never Better Auth's `url` argument, which
 *   carries the token in a path and then a query string;
 * - only accounts with an email/password credential get mail: a user row
 *   without one (seed fixture, future OAuth-only account) is skipped
 *   silently, because a reset would otherwise create a credential for it;
 * - after a successful reset, every other outstanding reset link of the
 *   user is deleted, and the password-changed notice is sent;
 * - `emailVerified` is never touched: verification is its own flow (10.7).
 *
 * Every outcome is logged as one `describeMailResult` line or a fixed
 * message. No recipient, link, token, body or provider text is logged, and
 * the hooks never throw, so Better Auth's public answer is the same generic
 * response whether or not the address has an account or the mail went out.
 */

export type RecoveryUser = { id: string; email: string; name?: string | null }

export type RecoveryDeps = {
  mailer: Mailer
  prisma: { account: Pick<Prisma.TransactionClient["account"], "findFirst">; verification: Pick<Prisma.TransactionClient["verification"], "deleteMany"> }
  /** The application origin for links. Undefined only in local development, where it comes from Better Auth's own URL. */
  baseURL: string | undefined
  /** Runs work after the response when the host supports it (Next.js `after`), so known and unknown addresses answer alike. */
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

export function createRecoveryHooks(deps: RecoveryDeps) {
  const log = deps.log ?? ((line: string) => console.info(line))
  const run = (task: Promise<void>) => (deps.background ? deps.background(task) : task)

  async function sendResetPassword({ user, url, token }: { user: RecoveryUser; url: string; token: string }): Promise<void> {
    const credential = await deps.prisma.account.findFirst({ where: { userId: user.id, providerId: "credential" }, select: { id: true } })
    if (!credential) {
      log("[auth] password reset requested for an account without a password; no mail sent")
      return
    }
    const origin = deps.baseURL ?? originOf(url)
    const resetUrl = origin ? buildPasswordResetUrl(origin, token) : null
    const rendered = resetUrl ? passwordResetEmail({ to: user.email, resetUrl, name: user.name }) : null
    if (!rendered?.ok) {
      log("[auth] password reset link could not be built from the configured base URL; no mail sent")
      return
    }
    await deliverAndLog(deps.mailer, rendered.message, log)
  }

  async function onPasswordReset({ user }: { user: RecoveryUser }): Promise<void> {
    // Reset links are the only Verification rows whose value is a user id; the one just used is already gone.
    await deps.prisma.verification.deleteMany({ where: { value: user.id } })
    await run(deliverAndLog(deps.mailer, passwordChangedEmail({ to: user.email, name: user.name }), log).then(() => undefined))
  }

  return { sendResetPassword, onPasswordReset }
}
