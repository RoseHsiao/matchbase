import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { ATTENTION_STATES, consecutiveFailures, describeRun, evaluateSourceHealth, summarizeRun, type SourceHealthInput, type SyncRunSummary } from "../../lib/data/sync/health"

const HOUR = 3_600_000
const NOW = new Date("2026-09-18T12:00:00Z")
const schedule = { expectedIntervalMs: 24 * HOUR, graceMs: 3 * HOUR, staleLockMs: 15 * 60_000 }

function run(status: SyncRunSummary["status"], hoursAgo: number, error?: string, extra: Partial<{ records: number; durationMs: number }> = {}): SyncRunSummary {
  return summarizeRun({ id: `r-${status}-${hoursAgo}`, status, at: new Date(NOW.getTime() - hoursAgo * HOUR).toISOString(), durationMs: extra.durationMs ?? 75_000, records: extra.records ?? 53, error })
}

const live = { kind: "live" as const, configured: true }

function evaluate(overrides: Partial<SourceHealthInput>) {
  return evaluateSourceHealth({ enabled: true, provider: live, lastSuccessfulSyncAt: null, recentRuns: [], now: NOW, schedule, ...overrides })
}

describe("summarizeRun", () => {
  test("classifies stored messages by the pipeline's own prefixes", () => {
    assert.equal(summarizeRun({ id: "a", status: "success", at: NOW.toISOString(), durationMs: 1, records: 1, error: null }).category, "ok")
    assert.equal(summarizeRun({ id: "a", status: "failed", at: NOW.toISOString(), durationMs: 1, records: 0, error: "Abandoned: the run did not finish within 15 minutes and was marked failed by a later run." }).category, "abandoned")
    assert.equal(summarizeRun({ id: "a", status: "failed", at: NOW.toISOString(), durationMs: 1, records: 0, error: "Configuration error: SPORTRADAR_API_KEY is not set." }).category, "configuration")
    assert.equal(summarizeRun({ id: "a", status: "failed", at: NOW.toISOString(), durationMs: 1, records: 0, error: "Rate limited by the provider (retries exhausted): HTTP 429 from https://x" }).category, "rate-limit")
    assert.equal(summarizeRun({ id: "a", status: "failed", at: NOW.toISOString(), durationMs: 1, records: 0, error: "Provider server error (retries exhausted): HTTP 503 from https://x" }).category, "server")
    assert.equal(summarizeRun({ id: "a", status: "failed", at: NOW.toISOString(), durationMs: 1, records: 0, error: "Could not reach the provider (retries exhausted): fetch failed" }).category, "network")
    assert.equal(summarizeRun({ id: "a", status: "failed", at: NOW.toISOString(), durationMs: 1, records: 0, error: "Provider request timed out (retries exhausted): x" }).category, "timeout")
    assert.equal(summarizeRun({ id: "a", status: "failed", at: NOW.toISOString(), durationMs: 1, records: 0, error: "Provider returned a malformed response: expected a JSON object" }).category, "malformed")
    assert.equal(summarizeRun({ id: "a", status: "failed", at: NOW.toISOString(), durationMs: 1, records: 0, error: "No provider is registered for this data source." }).category, "unbound")
    assert.equal(summarizeRun({ id: "a", status: "running", at: NOW.toISOString(), durationMs: 0, records: 0, error: null }).category, "running")
  })

  test("an issue list is summarised by counts and its first line", () => {
    const s = summarizeRun({ id: "a", status: "partial", at: NOW.toISOString(), durationMs: 1, records: 24, error: "ERROR match 5009: Team 999 was not synced.\nWARNING match 5008: Unmapped provider status \"PPD\".\nWARNING season 2001: demoted." })
    assert.equal(s.category, "issues")
    assert.equal(s.errorCount, 1)
    assert.equal(s.warningCount, 2)
    assert.equal(s.summary, "ERROR match 5009: Team 999 was not synced.")
    assert.equal(describeRun(s), "1 record error, 2 warnings")
  })

  test("long first lines are truncated for tables", () => {
    const s = summarizeRun({ id: "a", status: "failed", at: NOW.toISOString(), durationMs: 1, records: 0, error: "x".repeat(400) })
    assert.ok(s.summary!.length <= 160)
  })
})

describe("evaluateSourceHealth precedence", () => {
  test("placeholder: no provider bound", () => {
    const r = evaluate({ provider: undefined, recentRuns: [run("failed", 1, "boom")] })
    assert.equal(r.state, "placeholder")
    assert.equal(r.needsAttention, false)
  })

  test("disabled beats everything but placeholder", () => {
    const r = evaluate({ enabled: false, recentRuns: [run("failed", 1, "boom"), run("failed", 2, "boom")] })
    assert.equal(r.state, "disabled")
    assert.equal(r.needsAttention, false)
  })

  test("mock feeds are informational even with partial runs", () => {
    const r = evaluate({ provider: { kind: "mock", configured: true }, lastSuccessfulSyncAt: new Date(NOW.getTime() - HOUR).toISOString(), recentRuns: [run("partial", 1, "ERROR match 5009: Team 999 was not synced.")] })
    assert.equal(r.state, "mock")
    assert.equal(r.needsAttention, false)
    assert.match(r.reasons[1], /expected for the mock feed/)
  })

  test("not configured is explained, not treated as a failure", () => {
    const r = evaluate({ provider: { kind: "live", configured: false, configurationError: "SPORTRADAR_API_KEY is not set" }, recentRuns: [run("failed", 1, "Configuration error: SPORTRADAR_API_KEY is not set")] })
    assert.equal(r.state, "not-configured")
    assert.equal(r.needsAttention, false)
    assert.match(r.reasons[0], /SPORTRADAR_API_KEY is not set/)
  })

  test("syncing: a RUNNING latest run inside the stale threshold", () => {
    const r = evaluate({ lastSuccessfulSyncAt: new Date(NOW.getTime() - HOUR).toISOString(), recentRuns: [run("running", 0.05), run("success", 1)] })
    assert.equal(r.state, "syncing")
    assert.equal(r.execution, "syncing")
    assert.equal(r.needsAttention, false)
  })

  test("never synced: no successful run yet", () => {
    assert.equal(evaluate({}).state, "never-synced")
    const withFailure = evaluate({ recentRuns: [run("failed", 1, "Provider server error (retries exhausted): HTTP 500")] })
    assert.equal(withFailure.state, "never-synced")
    assert.match(withFailure.reasons[0], /only run so far failed: provider server error/)
    assert.equal(withFailure.needsAttention, true)
  })

  test("healthy: fresh and the latest run succeeded", () => {
    const r = evaluate({ lastSuccessfulSyncAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(), recentRuns: [run("success", 2), run("success", 26)] })
    assert.equal(r.state, "healthy")
    assert.equal(r.needsAttention, false)
    assert.equal(r.freshness.state, "fresh")
    assert.equal(r.consecutiveFailures, 0)
    assert.match(r.reasons[0], /succeeded with 53 records/)
  })

  test("stale: last success beyond interval plus grace, whatever the last run said", () => {
    const r = evaluate({ lastSuccessfulSyncAt: new Date(NOW.getTime() - 30 * HOUR).toISOString(), recentRuns: [run("success", 30)] })
    assert.equal(r.state, "stale")
    assert.equal(r.needsAttention, true)
    assert.match(r.reasons[0], /30 h old, beyond the 27 h threshold/)
  })

  test("exact freshness boundary: 27 h is still fresh, one millisecond more is stale", () => {
    const boundary = new Date(NOW.getTime() - 27 * HOUR).toISOString()
    assert.equal(evaluate({ lastSuccessfulSyncAt: boundary, recentRuns: [run("success", 27)] }).state, "healthy")
    assert.equal(evaluate({ lastSuccessfulSyncAt: new Date(NOW.getTime() - 27 * HOUR - 1).toISOString(), recentRuns: [run("success", 27)] }).state, "stale")
  })

  test("degraded: fresh but the latest run was PARTIAL, records still written", () => {
    const r = evaluate({ lastSuccessfulSyncAt: new Date(NOW.getTime() - HOUR).toISOString(), recentRuns: [run("partial", 1, "ERROR match 5009: Team 999 was not synced.", { records: 24 })] })
    assert.equal(r.state, "degraded")
    assert.equal(r.needsAttention, true)
    assert.match(r.reasons[0], /partial: 1 record error\. 24 records were still written/)
  })

  test("degraded: fresh with one isolated failure after a success", () => {
    const r = evaluate({ lastSuccessfulSyncAt: new Date(NOW.getTime() - 25 * HOUR).toISOString(), recentRuns: [run("failed", 1, "Provider server error (retries exhausted): HTTP 500 from https://api.example.test/x"), run("success", 25)] })
    assert.equal(r.state, "degraded")
    assert.equal(r.consecutiveFailures, 1)
    assert.match(r.reasons[0], /latest run failed: provider server error/)
  })

  test("failing: two or more consecutive failures, even while data is still fresh", () => {
    const r = evaluate({ lastSuccessfulSyncAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(), recentRuns: [run("failed", 0.5, "Could not reach the provider (retries exhausted): fetch failed"), run("failed", 1, "Could not reach the provider (retries exhausted): fetch failed"), run("success", 2)] })
    assert.equal(r.state, "failing")
    assert.equal(r.consecutiveFailures, 2)
    assert.equal(r.needsAttention, true)
    assert.match(r.reasons[0], /2 consecutive failed runs/)
    assert.match(r.reasons[1], /provider unreachable/)
  })

  test("a recovered abandoned run counts as a failure and is named as such", () => {
    const abandoned = run("failed", 1, "Abandoned: the run did not finish within 15 minutes and was marked failed by a later run.")
    const one = evaluate({ lastSuccessfulSyncAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(), recentRuns: [abandoned, run("success", 2)] })
    assert.equal(one.state, "degraded")
    assert.equal(one.latestRun?.category, "abandoned")
    assert.match(one.reasons[0], /previous run died; lock recovered/)
    const two = evaluate({ lastSuccessfulSyncAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(), recentRuns: [abandoned, run("failed", 1.5, "Provider server error (retries exhausted): HTTP 500"), run("success", 2)] })
    assert.equal(two.state, "failing")
  })

  test("a RUNNING row older than the stale threshold is a failure in waiting, not 'syncing'", () => {
    const r = evaluate({ lastSuccessfulSyncAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(), recentRuns: [run("running", 1), run("success", 2)] })
    assert.notEqual(r.state, "syncing")
    assert.equal(r.state, "degraded")
    assert.match(r.reasons[0], /longer than the stale-lock threshold/)
    assert.equal(consecutiveFailures([run("running", 1), run("failed", 2, "x"), run("success", 3)], NOW, schedule.staleLockMs), 2)
  })

  test("streak stops at the last successful or partial run", () => {
    assert.equal(consecutiveFailures([run("failed", 1, "x"), run("partial", 2, "WARNING x"), run("failed", 3, "x")], NOW, schedule.staleLockMs), 1)
    assert.equal(consecutiveFailures([], NOW, schedule.staleLockMs), 0)
  })

  test("deterministic for an injected now; moving now flips fresh to stale", () => {
    const input = { lastSuccessfulSyncAt: new Date(NOW.getTime() - 20 * HOUR).toISOString(), recentRuns: [run("success", 20)] }
    assert.equal(evaluate(input).state, evaluate(input).state)
    assert.equal(evaluate(input).state, "healthy")
    assert.equal(evaluate({ ...input, now: new Date(NOW.getTime() + 10 * HOUR) }).state, "stale")
  })

  test("attention states are exactly failing, stale, degraded and never-synced", () => {
    assert.deepEqual([...ATTENTION_STATES].sort(), ["degraded", "failing", "never-synced", "stale"])
  })
})
