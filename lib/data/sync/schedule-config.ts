/**
 * The scheduled-sync cadence and the timings derived from it. One place, so
 * the cron schedule in vercel.json, the freshness threshold in Admin and the
 * scheduler's own gates agree. Pure; safe to import anywhere on the server.
 *
 * Deployment facts (Vercel docs, verified 2026-09-17, see
 * docs/scheduled-sync.md): cron expressions are evaluated in UTC; Hobby
 * plans allow at most one invocation per day, fired anywhere inside the
 * scheduled hour; Pro plans allow per-minute schedules. The committed
 * schedule is therefore daily so it deploys on either plan.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** Cron expression registered in vercel.json. UTC: 03:00 UTC is 11:00 in Asia/Taipei. */
export const SCHEDULED_SYNC_CRON = "0 3 * * *"
export const SCHEDULED_SYNC_TIME_ZONE = "UTC"

export type ScheduleConfig = {
  /** How often the scheduler is expected to run a source; drives freshness. */
  expectedIntervalMs: number
  /** Late invocation and run-time tolerance before a source counts as stale (Hobby fires within a 59-minute window). */
  graceMs: number
  /** A source synced successfully more recently than this is skipped: Vercel may deliver a cron run twice. */
  minIntervalMs: number
  /** Wall-clock budget for one scheduler invocation; sources not started before it are skipped. Under the 300 s function limit. */
  timeBudgetMs: number
  /** A RUNNING sync log older than this is treated as abandoned and marked failed. */
  staleLockMs: number
}

function minutes(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return value !== undefined && value.trim() !== "" && Number.isFinite(n) && n > 0 ? n * MINUTE : fallback
}

export function readScheduleConfig(env: Record<string, string | undefined> = process.env): ScheduleConfig {
  return {
    expectedIntervalMs: minutes(env.SYNC_EXPECTED_INTERVAL_MINUTES, 24 * HOUR),
    graceMs: minutes(env.SYNC_FRESHNESS_GRACE_MINUTES, 3 * HOUR),
    minIntervalMs: minutes(env.SYNC_MIN_INTERVAL_MINUTES, 30 * MINUTE),
    timeBudgetMs: minutes(env.SYNC_TIME_BUDGET_MINUTES, 4 * MINUTE),
    staleLockMs: minutes(env.SYNC_STALE_LOCK_MINUTES, 15 * MINUTE),
  }
}

/** The defaults, for callers without an environment (tests, pure helpers). */
export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = readScheduleConfig({})
