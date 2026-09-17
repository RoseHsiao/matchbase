import { handleCronSync } from "@/lib/api/cron-sync"
import { runScheduledSyncsFromDatabase } from "@/lib/data/sync/scheduled-sync-service"

/**
 * Vercel Cron trigger (vercel.json → /api/cron/sync). Authenticates with
 * CRON_SECRET, runs the provider-neutral scheduler, returns its summary.
 *
 * Node.js runtime: the sync stack uses Prisma over PostgreSQL and a run
 * takes over a minute. maxDuration 300 s is the Hobby plan's maximum and
 * the default on every plan with Fluid compute; the scheduler stops
 * starting new sources after its 4-minute budget so one invocation always
 * returns inside that limit.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: Request): Promise<Response> {
  return handleCronSync(request, { env: process.env, run: (trigger, now) => runScheduledSyncsFromDatabase(trigger, now) })
}
