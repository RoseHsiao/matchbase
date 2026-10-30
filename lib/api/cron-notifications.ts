import { authorizeCronRequest } from "@/lib/api/cron-sync"
import { logServerError } from "@/lib/logging/server-log"
import type { DeliverySummary } from "@/lib/notifications/delivery"
import { reminderEmailsAvailable } from "@/lib/notifications/preferences-ops"

/**
 * The notification cron boundary (Phase 11): the same `Authorization:
 * Bearer <CRON_SECRET>` check as the sync cron, then one delivery run. The
 * run happens only when reminder email is available, by the same rule the
 * Watchlist offer and the opt-in action use (`reminderEmailsAvailable`:
 * AUTH_EMAIL_VERIFICATION_ENABLED plus a deliverable transport). Otherwise
 * nothing is planned or sent, including for users who opted in while it was
 * available: switching it off stops reminder email for everyone. The run is injected so this handler is tested with
 * plain Request objects and no database.
 */

export type CronNotificationsDeps = {
  env: Record<string, string | undefined>
  run: (now: Date) => Promise<DeliverySummary>
  now?: () => Date
}

const NO_STORE = { "cache-control": "no-store" }

export async function handleCronNotifications(request: Request, deps: CronNotificationsDeps): Promise<Response> {
  const auth = authorizeCronRequest(request, deps.env)
  if (!auth.ok) return Response.json({ ok: false, error: auth.reason }, { status: auth.status, headers: NO_STORE })
  if (!reminderEmailsAvailable(deps.env)) return Response.json({ ok: true, skipped: "reminder-email-unavailable" }, { headers: NO_STORE })
  try {
    const summary = await deps.run(deps.now?.() ?? new Date())
    return Response.json({ ok: true, ...summary }, { headers: NO_STORE })
  } catch (error) {
    logServerError("cron-notifications", error, deps.env)
    return Response.json({ ok: false, error: "Notification delivery failed unexpectedly; see server logs." }, { status: 500, headers: NO_STORE })
  }
}
