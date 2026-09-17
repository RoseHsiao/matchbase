/**
 * Pure freshness model for a data source. Freshness describes the *source*
 * (when did its last successful sync finish, relative to how often it is
 * expected to run), never the matches it produced. Execution state (idle,
 * syncing, failed) is a separate fact read from the latest sync log.
 *
 * `now` is always injected so tests are deterministic and components do not
 * scatter `Date.now() - lastSyncedAt` arithmetic.
 */

export type Freshness = "never" | "fresh" | "stale"

export type FreshnessInput = {
  /** When the last SUCCESS or PARTIAL run finished; null when the source never synced. */
  lastSuccessfulSyncAt: Date | string | null | undefined
  /** How often the source is expected to sync (the cadence). */
  expectedIntervalMs: number
  /** Tolerance for late invocations and run time before "stale" is declared. */
  graceMs?: number
  now: Date
}

export type FreshnessResult = {
  state: Freshness
  /** Milliseconds since the last successful sync; null when never synced. */
  ageMs: number | null
  /** The age at which the source is considered stale. */
  staleAfterMs: number
}

function toMs(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const ms = typeof value === "string" ? Date.parse(value) : value.getTime()
  return Number.isNaN(ms) ? null : ms
}

/** Fresh while the age is at most expected + grace; stale beyond that; never when there is no successful sync. */
export function getDataSourceFreshness(input: FreshnessInput): FreshnessResult {
  if (!(input.expectedIntervalMs > 0)) throw new Error("expectedIntervalMs must be positive.")
  const staleAfterMs = input.expectedIntervalMs + Math.max(0, input.graceMs ?? 0)
  const last = toMs(input.lastSuccessfulSyncAt)
  if (last === null) return { state: "never", ageMs: null, staleAfterMs }
  const ageMs = input.now.getTime() - last
  return { state: ageMs > staleAfterMs ? "stale" : "fresh", ageMs, staleAfterMs }
}

export type SyncExecutionState = "idle" | "syncing" | "failed"

/** What the source is doing now, from its most recent sync log. PARTIAL counts as failed for attention purposes. */
export function getSyncExecutionState(latest: { status: "running" | "success" | "partial" | "failed" } | undefined): SyncExecutionState {
  if (!latest) return "idle"
  if (latest.status === "running") return "syncing"
  if (latest.status === "failed" || latest.status === "partial") return "failed"
  return "idle"
}

const HOUR = 3_600_000

/** "fresh", "stale (31 h old)", "never synced". */
export function freshnessLabel(result: FreshnessResult): string {
  if (result.state === "never") return "never synced"
  const hours = Math.round((result.ageMs ?? 0) / HOUR)
  const age = hours < 1 ? "under an hour" : `${hours} h`
  return result.state === "fresh" ? `fresh (${age} old)` : `stale (${age} old)`
}
