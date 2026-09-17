import type { Provider, SyncResult } from "@/lib/data/sync/types"

/**
 * Provider-neutral scheduled orchestration: which sources to sync and in
 * what order, delegating every single-source run to the same pipeline the
 * CLI and Admin use. Nothing here knows a provider, a sport, or Vercel;
 * dependencies are injected so it runs in tests without a database.
 *
 *   discover sources → eligibility → recency gate → time budget →
 *   sync(source) (which takes the database lock) → summarise
 *
 * Failures are isolated: a source that fails, is locked, or is skipped
 * never stops the next one. Outcomes are summarised, not re-logged; the
 * single-source pipeline already owns the SyncLog rows.
 */

export type SchedulerSource = {
  id: string
  name: string
  status: "ACTIVE" | "INACTIVE"
  /** Last SUCCESS or PARTIAL run; null when never synced. */
  lastSyncedAt: Date | null
}

export type SchedulerDeps = {
  listSources(): Promise<SchedulerSource[]>
  resolveProvider(dataSourceId: string): Provider<never> | undefined
  /** The single-source pipeline (runSync). Must take the per-source lock itself. */
  sync(dataSourceId: string, options: { now: Date }): Promise<SyncResult>
}

export type ScheduleTrigger = "cron" | "manual" | "test"

export type ScheduledSyncOptions = {
  trigger: ScheduleTrigger
  now?: Date
  /** Skip a source whose last successful sync is younger than this (duplicate cron deliveries). 0 disables the gate. */
  minIntervalMs?: number
  /** Do not start a source once this much wall-clock time has elapsed. */
  timeBudgetMs?: number
}

export type SourceOutcome = "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED_LOCKED" | "SKIPPED_RECENT" | "SKIPPED_BUDGET" | "INELIGIBLE"

export type SourceSummary = {
  id: string
  name: string
  outcome: SourceOutcome
  /** Why it was skipped or how it failed. Never contains credentials (the pipeline redacts). */
  reason?: string
  records?: number
  durationMs?: number
  syncLogId?: string | null
}

export type ScheduledSyncSummary = {
  trigger: ScheduleTrigger
  startedAt: string
  durationMs: number
  sources: SourceSummary[]
  counts: Record<SourceOutcome, number>
}

export type Eligibility = { eligible: true } | { eligible: false; reason: string }

/**
 * A source is scheduled automatically when it is active, bound to a *live*
 * provider, and that provider reports itself configured. No provider is
 * named: mock feeds are excluded by their kind, an unconfigured live feed
 * by its own readiness check, a disabled source by its status.
 */
export function isSchedulable(source: Pick<SchedulerSource, "status">, provider: Provider<never> | undefined): Eligibility {
  if (source.status !== "ACTIVE") return { eligible: false, reason: "source is disabled" }
  if (!provider) return { eligible: false, reason: "no provider is bound" }
  if (provider.kind !== "live") return { eligible: false, reason: "mock provider; demo feeds are never scheduled" }
  const readiness = provider.checkConfiguration?.()
  if (readiness && !readiness.configured) return { eligible: false, reason: `provider not configured: ${readiness.error}` }
  return { eligible: true }
}

function emptyCounts(): Record<SourceOutcome, number> {
  return { SUCCESS: 0, PARTIAL: 0, FAILED: 0, SKIPPED_LOCKED: 0, SKIPPED_RECENT: 0, SKIPPED_BUDGET: 0, INELIGIBLE: 0 }
}

export async function runScheduledSyncs(options: ScheduledSyncOptions, deps: SchedulerDeps): Promise<ScheduledSyncSummary> {
  const now = options.now ?? new Date()
  const clock = Date.now()
  const minIntervalMs = options.minIntervalMs ?? 0
  const timeBudgetMs = options.timeBudgetMs ?? Number.POSITIVE_INFINITY
  const sources = await deps.listSources()
  const summaries: SourceSummary[] = []
  const counts = emptyCounts()
  const record = (summary: SourceSummary) => {
    summaries.push(summary)
    counts[summary.outcome]++
  }

  for (const source of sources) {
    const provider = deps.resolveProvider(source.id)
    const eligibility = isSchedulable(source, provider)
    if (!eligibility.eligible) {
      record({ id: source.id, name: source.name, outcome: "INELIGIBLE", reason: eligibility.reason })
      continue
    }
    if (minIntervalMs > 0 && source.lastSyncedAt && now.getTime() - source.lastSyncedAt.getTime() < minIntervalMs) {
      record({ id: source.id, name: source.name, outcome: "SKIPPED_RECENT", reason: `last successful sync ${Math.round((now.getTime() - source.lastSyncedAt.getTime()) / 60_000)} min ago, under the ${Math.round(minIntervalMs / 60_000)} min minimum` })
      continue
    }
    if (Date.now() - clock > timeBudgetMs) {
      record({ id: source.id, name: source.name, outcome: "SKIPPED_BUDGET", reason: "time budget for this invocation is exhausted; next invocation will pick it up" })
      continue
    }
    try {
      const result = await deps.sync(source.id, { now })
      const outcome: SourceOutcome = result.status === "SKIPPED" ? "SKIPPED_LOCKED" : result.status
      record({ id: source.id, name: source.name, outcome, reason: result.error, records: result.records, durationMs: result.durationMs, syncLogId: result.syncLogId })
    } catch (error) {
      // The pipeline reports its own failures; this catches anything unexpected so the next source still runs.
      record({ id: source.id, name: source.name, outcome: "FAILED", reason: error instanceof Error ? error.message : String(error) })
    }
  }

  return { trigger: options.trigger, startedAt: now.toISOString(), durationMs: Date.now() - clock, sources: summaries, counts }
}
