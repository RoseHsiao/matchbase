import { getDataSourceFreshness, getSyncExecutionState, type FreshnessResult, type SyncExecutionState } from "@/lib/data/sync/freshness"

/**
 * Operational health of a data source, derived from persisted evidence only:
 * the source's enabled flag, the bound provider's kind and readiness, the
 * last successful sync, and a bounded list of recent sync logs. Pure, with
 * an injected `now`, so the same input always yields the same verdict and
 * Admin merely renders it.
 *
 * Health and freshness are distinct. Freshness says how old the last good
 * data is; health says whether the source needs a human. "Fresh but the last
 * run failed" is degraded (data is still current, one run misfired); "fresh
 * but three runs failed in a row" is failing (the next data will not come);
 * "stale" means the data itself has aged past the cadence, whatever the
 * last run said.
 */

// ---------------------------------------------------------------------------
// Runs: what a SyncLog row means operationally
// ---------------------------------------------------------------------------

export type SyncRunStatus = "running" | "success" | "partial" | "failed"

/**
 * Why a run ended the way it did, read from the message the pipeline stored.
 * "abandoned" is a run whose process died and whose lock a later run
 * recovered; it is a FAILED row with a distinctive message, not a status.
 */
export type SyncRunCategory =
  | "ok"
  | "running"
  | "issues"
  | "abandoned"
  | "configuration"
  | "auth"
  | "rate-limit"
  | "server"
  | "client"
  | "timeout"
  | "network"
  | "malformed"
  | "unbound"
  | "failed"

export type SyncRunSummary = {
  id: string
  status: SyncRunStatus
  /** ISO start instant. */
  at: string
  durationMs: number
  records: number
  category: SyncRunCategory
  /** First line of the stored message, for tables. Already redacted at persistence. */
  summary?: string
  /** Counts of record-level issues in the stored issue list. */
  errorCount: number
  warningCount: number
}

const CATEGORY_PREFIXES: [RegExp, SyncRunCategory][] = [
  [/^Abandoned:/i, "abandoned"],
  [/^Configuration error/i, "configuration"],
  [/^Authentication rejected/i, "auth"],
  [/^Rate limited/i, "rate-limit"],
  [/^Provider server error/i, "server"],
  [/^Provider rejected the request/i, "client"],
  [/^Provider request timed out/i, "timeout"],
  [/^Could not reach the provider/i, "network"],
  [/^Provider returned a malformed response|returned data the adapter could not normalize/i, "malformed"],
  [/^No provider is registered|does not exist\.|is scoped to/i, "unbound"],
]

const SUMMARY_LENGTH = 160

/** Classify a stored run and summarise its message without exposing the whole text. */
export function summarizeRun(run: { id: string; status: SyncRunStatus; at: string; durationMs: number; records: number; error?: string | null }): SyncRunSummary {
  const text = run.error?.trim() ?? ""
  const lines = text ? text.split("\n") : []
  const errorCount = lines.filter((l) => /^ERROR\b/.test(l)).length
  const warningCount = lines.filter((l) => /^WARNING\b/.test(l)).length
  let category: SyncRunCategory
  if (run.status === "running") category = "running"
  else if (!text) category = "ok"
  else {
    const prefixed = CATEGORY_PREFIXES.find(([pattern]) => pattern.test(text))
    category = prefixed ? prefixed[1] : errorCount + warningCount > 0 ? "issues" : run.status === "failed" ? "failed" : "issues"
  }
  const first = lines[0] ?? ""
  const summary = text ? (first.length > SUMMARY_LENGTH ? `${first.slice(0, SUMMARY_LENGTH - 1)}…` : first) : undefined
  return { id: run.id, status: run.status, at: run.at, durationMs: run.durationMs, records: run.records, category, summary, errorCount, warningCount }
}

/** "3 errors, 1 warning" for an issue list; the category label otherwise. */
export function describeRun(run: SyncRunSummary): string {
  switch (run.category) {
    case "ok":
      return "completed cleanly"
    case "running":
      return "in progress"
    case "issues": {
      const parts = [run.errorCount > 0 ? `${run.errorCount} record ${run.errorCount === 1 ? "error" : "errors"}` : "", run.warningCount > 0 ? `${run.warningCount} ${run.warningCount === 1 ? "warning" : "warnings"}` : ""].filter(Boolean)
      return parts.length > 0 ? parts.join(", ") : "issues recorded"
    }
    case "abandoned":
      return "previous run died; lock recovered"
    case "configuration":
      return "configuration problem"
    case "auth":
      return "credentials rejected"
    case "rate-limit":
      return "rate limited by the provider"
    case "server":
      return "provider server error"
    case "client":
      return "provider rejected the request"
    case "timeout":
      return "provider timed out"
    case "network":
      return "provider unreachable"
    case "malformed":
      return "provider response malformed"
    case "unbound":
      return "no provider bound"
    case "failed":
      return "failed"
  }
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export type SourceHealthState =
  | "placeholder"
  | "mock"
  | "disabled"
  | "not-configured"
  | "syncing"
  | "failing"
  | "never-synced"
  | "stale"
  | "degraded"
  | "healthy"

export type SourceHealthInput = {
  enabled: boolean
  provider?: { kind: "live" | "mock"; configured: boolean; configurationError?: string }
  lastSuccessfulSyncAt?: string | null
  /** Newest first, bounded (the repository loads at most `RECENT_RUNS` per source). */
  recentRuns: SyncRunSummary[]
  now: Date
  schedule: { expectedIntervalMs: number; graceMs: number; staleLockMs: number }
}

export type SourceHealthReport = {
  state: SourceHealthState
  /** True for states an administrator should act on. */
  needsAttention: boolean
  freshness: FreshnessResult
  execution: SyncExecutionState
  latestRun?: SyncRunSummary
  lastSuccess?: SyncRunSummary
  lastFailure?: SyncRunSummary
  /** FAILED runs (abandoned ones included) since the last SUCCESS or PARTIAL, newest first. */
  consecutiveFailures: number
  /** Plain-language evidence for the state, most important first. */
  reasons: string[]
}

/** How many recent runs the repository loads per source; enough for a streak, bounded. */
export const RECENT_RUNS = 10
/** Two failures in a row is a pattern, one is an incident. */
export const FAILING_STREAK = 2

function isSuccessful(run: SyncRunSummary): boolean {
  return run.status === "success" || run.status === "partial"
}

/** Failed runs since the last successful one. A RUNNING row older than the stale threshold counts as a failure in waiting. */
export function consecutiveFailures(runs: SyncRunSummary[], now: Date, staleLockMs: number): number {
  let streak = 0
  for (const run of runs) {
    if (run.status === "running") {
      if (now.getTime() - Date.parse(run.at) > staleLockMs) streak++
      continue
    }
    if (isSuccessful(run)) break
    streak++
  }
  return streak
}

export function evaluateSourceHealth(input: SourceHealthInput): SourceHealthReport {
  const { now, schedule } = input
  const runs = input.recentRuns
  const freshness = getDataSourceFreshness({ lastSuccessfulSyncAt: input.lastSuccessfulSyncAt, expectedIntervalMs: schedule.expectedIntervalMs, graceMs: schedule.graceMs, now })
  const latestRun = runs[0]
  const execution = getSyncExecutionState(latestRun ? { status: latestRun.status } : undefined)
  const lastSuccess = runs.find(isSuccessful)
  const lastFailure = runs.find((run) => run.status === "failed")
  const streak = consecutiveFailures(runs, now, schedule.staleLockMs)
  const reasons: string[] = []
  const report = (state: SourceHealthState, needsAttention: boolean): SourceHealthReport => ({ state, needsAttention, freshness, execution, latestRun, lastSuccess, lastFailure, consecutiveFailures: streak, reasons })

  if (!input.provider) {
    reasons.push("No provider is bound; this source is a placeholder.")
    return report("placeholder", false)
  }
  if (!input.enabled) {
    reasons.push("The source is disabled; it is never synced automatically.")
    return report("disabled", false)
  }
  if (input.provider.kind === "mock") {
    reasons.push("Mock provider serving deterministic fixtures; never scheduled and never a production signal.")
    if (latestRun && latestRun.category !== "ok") reasons.push(`Latest run: ${describeRun(latestRun)} (expected for the mock feed).`)
    return report("mock", false)
  }
  if (!input.provider.configured) {
    reasons.push(input.provider.configurationError ? `Not configured: ${input.provider.configurationError}` : "The provider is not configured.")
    return report("not-configured", false)
  }
  const stalledRunning = latestRun?.status === "running" && now.getTime() - Date.parse(latestRun.at) > schedule.staleLockMs
  if (latestRun?.status === "running" && !stalledRunning) {
    reasons.push(`A run started ${Math.round((now.getTime() - Date.parse(latestRun.at)) / 60_000)} min ago and is still in progress.`)
    return report("syncing", false)
  }
  if (stalledRunning) reasons.push("The latest run has been marked running for longer than the stale-lock threshold; the next run will recover it as abandoned.")
  if (streak >= FAILING_STREAK) {
    reasons.push(`${streak} consecutive failed runs since the last success.`)
    if (lastFailure) reasons.push(`Latest failure: ${describeRun(lastFailure)}${lastFailure.summary ? ` (${lastFailure.summary})` : ""}.`)
    return report("failing", true)
  }
  if (freshness.state === "never") {
    reasons.push(lastFailure ? `Never synced successfully; the only run so far failed: ${describeRun(lastFailure)}.` : "Never synced; run a first sync.")
    return report("never-synced", true)
  }
  if (freshness.state === "stale") {
    reasons.push(`Last successful sync is ${Math.round((freshness.ageMs ?? 0) / 3_600_000)} h old, beyond the ${Math.round(freshness.staleAfterMs / 3_600_000)} h threshold.`)
    if (latestRun && latestRun.status === "failed") reasons.push(`Latest run failed: ${describeRun(latestRun)}.`)
    return report("stale", true)
  }
  if (stalledRunning) return report("degraded", true)
  if (latestRun?.status === "failed") {
    reasons.push(`Data is fresh, but the latest run failed: ${describeRun(latestRun)}${latestRun.summary ? ` (${latestRun.summary})` : ""}.`)
    return report("degraded", true)
  }
  if (latestRun?.status === "partial") {
    reasons.push(`Data is fresh; the latest run was partial: ${describeRun(latestRun)}. ${latestRun.records} records were still written.`)
    return report("degraded", true)
  }
  reasons.push(latestRun ? `Latest run succeeded with ${latestRun.records} records.` : "Last successful sync is within the expected interval.")
  return report("healthy", false)
}

/** Which states count as needing attention, for summaries. */
export const ATTENTION_STATES: readonly SourceHealthState[] = ["failing", "stale", "degraded", "never-synced"]
