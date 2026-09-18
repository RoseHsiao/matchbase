/**
 * Cooldown for the Admin "Sync now" button, derived from the source's own
 * run history rather than any new state.
 *
 * The database lock (Phase 8.3) stops two runs of one source at the same
 * time; it says nothing about a run that starts the moment the previous one
 * finished. An administrator clicking repeatedly would spend the provider's
 * request budget for no new data. So a manual run is refused while the last
 * successful run (SUCCESS or PARTIAL) is younger than the cooldown, unless
 * the latest run failed, because retrying after a failure is exactly what a
 * manual sync is for. A RUNNING latest run is left to the lock. The cron
 * scheduler has its own, longer recency gate (30 minutes) for a different
 * purpose: absorbing duplicate deliveries.
 */

export type ManualSyncRun = { status: "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED"; startedAt: Date }

export type ManualSyncVerdict = { allowed: true } | { allowed: false; reason: string; retryAfterMs: number }

export type ManualSyncInput = {
  /** Newest first. */
  runs: readonly ManualSyncRun[]
  now: Date
  cooldownMs: number
}

export function manualSyncPolicy({ runs, now, cooldownMs }: ManualSyncInput): ManualSyncVerdict {
  if (cooldownMs <= 0) return { allowed: true }
  const latest = runs[0]
  if (!latest || latest.status === "FAILED" || latest.status === "RUNNING") return { allowed: true }
  const lastSuccess = runs.find((run) => run.status === "SUCCESS" || run.status === "PARTIAL")
  if (!lastSuccess) return { allowed: true }
  const age = now.getTime() - lastSuccess.startedAt.getTime()
  if (age >= cooldownMs) return { allowed: true }
  const retryAfterMs = cooldownMs - age
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000))
  return {
    allowed: false,
    retryAfterMs,
    reason: `this source synced successfully ${Math.max(1, Math.round(age / 60_000))} min ago; manual syncs wait ${Math.round(cooldownMs / 60_000)} min between successful runs (retry after a failed run is always allowed). Try again in ${minutes} min.`,
  }
}
