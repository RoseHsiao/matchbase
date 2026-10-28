import { handleCronNotifications } from "@/lib/api/cron-notifications"
import { resolveAuthBaseUrl } from "@/lib/auth/auth-env"
import { db } from "@/lib/data/db"
import { createMailer } from "@/lib/mail/create-mailer"
import { readMailEnv } from "@/lib/mail/mail-env"
import { runReminderDelivery } from "@/lib/notifications/delivery"

/**
 * Reminder delivery trigger (Phase 11, docs/notifications.md). Authenticates
 * with CRON_SECRET and runs one bounded delivery pass. It is deliberately
 * **not** in vercel.json: the Hobby plan allows only daily crons, which
 * cannot deliver "15 minutes before" reminders, so the schedule is an
 * operator decision (Vercel Pro `*\/5 * * * *`, or an external scheduler
 * calling this route with the secret).
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: Request): Promise<Response> {
  const mail = readMailEnv(process.env)
  return handleCronNotifications(request, {
    env: process.env,
    mailDeliverable: mail.transport.kind !== "disabled",
    run: (now) => runReminderDelivery({ prisma: db, mailer: createMailer(mail, { env: process.env }), baseURL: resolveAuthBaseUrl(process.env), dailyCap: mail.dailyCap, now }),
  })
}
