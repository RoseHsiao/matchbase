import { authorizeCronRequest } from "@/lib/api/cron-sync"
import { logServerError } from "@/lib/logging/server-log"
import type { DeliverySummary } from "@/lib/notifications/delivery"

/**
 * The notification cron boundary (Phase 11): the same `Authorization:
 * Bearer <CRON_SECRET>` check as the sync cron, then one delivery run. When
 * no transport can deliver, nothing is planned: an intent that can never be
 * sent would only expire. The run is injected so this handler is tested with
 * plain Request objects and no database.
 */

export type CronNotificationsDeps = {
  env: Record<string, string | undefined>
  /** False when mail is disabled or refused in this environment (lib/mail/mail-env.ts). */
  mailDeliverable: boolean
  run: (now: Date) => Promise<DeliverySummary>
  now?: () => Date
}

const NO_STORE = { "cache-control": "no-store" }

export async function handleCronNotifications(request: Request, deps: CronNotificationsDeps): Promise<Response> {
  const auth = authorizeCronRequest(request, deps.env)
  if (!auth.ok) return Response.json({ ok: false, error: auth.reason }, { status: auth.status, headers: NO_STORE })
  if (!deps.mailDeliverable) return Response.json({ ok: true, skipped: "mail-disabled" }, { headers: NO_STORE })
  try {
    const summary = await deps.run(deps.now?.() ?? new Date())
    return Response.json({ ok: true, ...summary }, { headers: NO_STORE })
  } catch (error) {
    logServerError("cron-notifications", error, deps.env)
    return Response.json({ ok: false, error: "Notification delivery failed unexpectedly; see server logs." }, { status: 500, headers: NO_STORE })
  }
}
