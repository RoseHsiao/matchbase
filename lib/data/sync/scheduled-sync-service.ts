import "server-only"

import { db } from "@/lib/data/db"
import { readScheduleConfig } from "@/lib/data/sync/schedule-config"
import { runScheduledSyncs, type ScheduledSyncSummary, type ScheduleTrigger } from "@/lib/data/sync/scheduler"
import { resolveProvider } from "@/lib/data/sync/providers/registry"
import { syncDataSource } from "@/lib/data/sync/sync-service"

/**
 * The application's binding of the scheduler: sources from PostgreSQL, the
 * registry for providers, and `syncDataSource` (the same single-source
 * pipeline the CLI and Admin call). Server-only; the cron route calls this.
 */
export function runScheduledSyncsFromDatabase(trigger: ScheduleTrigger, now = new Date()): Promise<ScheduledSyncSummary> {
  const config = readScheduleConfig()
  return runScheduledSyncs(
    { trigger, now, minIntervalMs: config.minIntervalMs, timeBudgetMs: config.timeBudgetMs },
    {
      listSources: async () =>
        (await db.dataSource.findMany({ select: { id: true, name: true, status: true, lastSyncedAt: true }, orderBy: { name: "asc" } })).map((row) => ({
          id: row.id,
          name: row.name,
          status: row.status,
          lastSyncedAt: row.lastSyncedAt,
        })),
      resolveProvider,
      sync: (dataSourceId, options) => syncDataSource(dataSourceId, { now: options.now, staleLockMs: config.staleLockMs }),
    }
  )
}
