import type { EnvLike } from "@/lib/env/runtime-environment"
import type { Prisma } from "@/lib/generated/prisma/client"
import { readMailEnv } from "@/lib/mail/mail-env"

/**
 * The email-reminder preference (User.reminderEmails), against an injected
 * client like the other user-state operations, so the database tests run it
 * inside rolled-back transactions. The user id always comes from the caller's
 * session (lib/notifications/actions.ts); nothing here takes it from input.
 */

/**
 * Whether the Watchlist offers email reminders at all. They go only to confirmed
 * addresses, and confirming needs verification mail, so the offer follows
 * AUTH_EMAIL_VERIFICATION_ENABLED (with a deliverable transport), not the mere
 * presence of a transport.
 */
export function reminderEmailsAvailable(env: EnvLike): boolean {
  return readMailEnv(env).emailVerification.enabled
}

export type PreferenceClient = Pick<Prisma.TransactionClient, "user">

export type ReminderEmailSettings = { email: string; confirmed: boolean; enabled: boolean }

export type SetReminderEmailsResult = { ok: true; enabled: boolean } | { ok: false; error: string }

export async function readReminderEmailSettings(client: PreferenceClient, userId: string): Promise<ReminderEmailSettings | null> {
  const user = await client.user.findUnique({ where: { id: userId }, select: { email: true, emailVerified: true, reminderEmails: true } })
  return user ? { email: user.email, confirmed: user.emailVerified, enabled: user.reminderEmails } : null
}

/**
 * Turning reminders on needs a deployment that can send mail and a confirmed
 * address; turning them off always works.
 */
export async function setReminderEmails(client: PreferenceClient, userId: string, enabled: unknown, mailAvailable: boolean): Promise<SetReminderEmailsResult> {
  if (typeof enabled !== "boolean") return { ok: false, error: "Invalid setting." }
  const user = await client.user.findUnique({ where: { id: userId }, select: { emailVerified: true } })
  if (!user) return { ok: false, error: "Account not found." }
  if (enabled && !mailAvailable) return { ok: false, error: "Email reminders aren't available on this deployment." }
  if (enabled && !user.emailVerified) return { ok: false, error: "Confirm your email address first." }
  await client.user.update({ where: { id: userId }, data: { reminderEmails: enabled } })
  return { ok: true, enabled }
}
