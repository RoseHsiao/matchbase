import { RECENT_RUNS, summarizeRun, type SyncRunSummary } from "@/lib/data/sync/health"
import type { Prisma } from "@/lib/generated/prisma/client"
import type { SyncStatus as DbSyncStatus } from "@/lib/generated/prisma/enums"

/**
 * Bounded operational reads for Admin, built over any Prisma client. One
 * query loads every data source with its most recent runs (Prisma issues a
 * single batched query for the nested `take`, not one per source), and the
 * summaries are derived from the stored rows; nothing is counted or cached
 * separately, so nothing can drift.
 */

export type MonitoringClient = Pick<Prisma.TransactionClient, "dataSource" | "syncLog">

const runStatus: Record<DbSyncStatus, SyncRunSummary["status"]> = { RUNNING: "running", SUCCESS: "success", PARTIAL: "partial", FAILED: "failed" }

export type DataSourceWithRuns = {
  id: string
  name: string
  sportId: string | null
  status: "ACTIVE" | "INACTIVE"
  lastSyncedAt: Date | null
  /** Newest first, at most `RECENT_RUNS`. */
  recentRuns: SyncRunSummary[]
}

export async function loadDataSourcesWithRuns(db: MonitoringClient, perSource: number = RECENT_RUNS): Promise<DataSourceWithRuns[]> {
  const rows = await db.dataSource.findMany({
    include: { syncLogs: { select: { id: true, status: true, startedAt: true, durationMs: true, records: true, error: true }, orderBy: { startedAt: "desc" }, take: perSource } },
    orderBy: { name: "asc" },
  })
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    sportId: row.sportId,
    status: row.status,
    lastSyncedAt: row.lastSyncedAt,
    recentRuns: row.syncLogs.map((log) => summarizeRun({ id: log.id, status: runStatus[log.status], at: log.startedAt.toISOString(), durationMs: log.durationMs ?? 0, records: log.records, error: log.error })),
  }))
}

/** How many sync log rows the Admin snapshot loads; the Sync Logs page paginates within it. */
export const SYNC_LOG_LIMIT = 500

/** The most recent runs across all sources, bounded. */
export async function loadRecentSyncLogs(db: MonitoringClient, limit: number = SYNC_LOG_LIMIT) {
  return db.syncLog.findMany({ orderBy: { startedAt: "desc" }, take: limit })
}

/** The newest runs of one source, for the manual-sync cooldown (lib/data/sync/manual-sync-policy.ts). */
export async function loadRecentRuns(db: MonitoringClient, dataSourceId: string, limit = 5): Promise<{ status: "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED"; startedAt: Date }[]> {
  return db.syncLog.findMany({ where: { dataSourceId }, select: { status: true, startedAt: true }, orderBy: { startedAt: "desc" }, take: limit })
}
