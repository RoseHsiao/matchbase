import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { freshnessLabel, getDataSourceFreshness, getSyncExecutionState } from "../../lib/data/sync/freshness"
import { DEFAULT_SCHEDULE_CONFIG, readScheduleConfig, SCHEDULED_SYNC_CRON, SCHEDULED_SYNC_TIME_ZONE } from "../../lib/data/sync/schedule-config"

const HOUR = 3_600_000
const NOW = new Date("2026-09-18T12:00:00Z")
const DAY = 24 * HOUR

describe("getDataSourceFreshness", () => {
  test("never synced", () => {
    assert.deepEqual(getDataSourceFreshness({ lastSuccessfulSyncAt: null, expectedIntervalMs: DAY, now: NOW }), { state: "never", ageMs: null, staleAfterMs: DAY })
    assert.equal(getDataSourceFreshness({ lastSuccessfulSyncAt: undefined, expectedIntervalMs: DAY, now: NOW }).state, "never")
    assert.equal(getDataSourceFreshness({ lastSuccessfulSyncAt: "not a date", expectedIntervalMs: DAY, now: NOW }).state, "never")
  })

  test("fresh inside the interval, from a Date or an ISO string", () => {
    const r = getDataSourceFreshness({ lastSuccessfulSyncAt: new Date(NOW.getTime() - 2 * HOUR), expectedIntervalMs: DAY, now: NOW })
    assert.deepEqual(r, { state: "fresh", ageMs: 2 * HOUR, staleAfterMs: DAY })
    assert.equal(getDataSourceFreshness({ lastSuccessfulSyncAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(), expectedIntervalMs: DAY, now: NOW }).state, "fresh")
  })

  test("stale beyond the interval plus grace", () => {
    assert.equal(getDataSourceFreshness({ lastSuccessfulSyncAt: new Date(NOW.getTime() - 30 * HOUR), expectedIntervalMs: DAY, graceMs: 3 * HOUR, now: NOW }).state, "stale")
    assert.equal(getDataSourceFreshness({ lastSuccessfulSyncAt: new Date(NOW.getTime() - 26 * HOUR), expectedIntervalMs: DAY, graceMs: 3 * HOUR, now: NOW }).state, "fresh", "inside the grace window")
  })

  test("the exact boundary is still fresh; one millisecond past it is stale", () => {
    const boundary = getDataSourceFreshness({ lastSuccessfulSyncAt: new Date(NOW.getTime() - (DAY + 3 * HOUR)), expectedIntervalMs: DAY, graceMs: 3 * HOUR, now: NOW })
    assert.equal(boundary.state, "fresh")
    const past = getDataSourceFreshness({ lastSuccessfulSyncAt: new Date(NOW.getTime() - (DAY + 3 * HOUR + 1)), expectedIntervalMs: DAY, graceMs: 3 * HOUR, now: NOW })
    assert.equal(past.state, "stale")
  })

  test("deterministic for an injected now; a different now moves the answer", () => {
    const at = new Date(NOW.getTime() - 20 * HOUR)
    assert.equal(getDataSourceFreshness({ lastSuccessfulSyncAt: at, expectedIntervalMs: DAY, now: NOW }).state, "fresh")
    assert.equal(getDataSourceFreshness({ lastSuccessfulSyncAt: at, expectedIntervalMs: DAY, now: new Date(NOW.getTime() + 5 * HOUR) }).state, "stale")
    assert.equal(getDataSourceFreshness({ lastSuccessfulSyncAt: at, expectedIntervalMs: DAY, now: NOW }).ageMs, getDataSourceFreshness({ lastSuccessfulSyncAt: at, expectedIntervalMs: DAY, now: new Date(NOW) }).ageMs)
  })

  test("rejects a non-positive interval", () => {
    assert.throws(() => getDataSourceFreshness({ lastSuccessfulSyncAt: null, expectedIntervalMs: 0, now: NOW }), /positive/)
  })

  test("labels", () => {
    assert.equal(freshnessLabel(getDataSourceFreshness({ lastSuccessfulSyncAt: null, expectedIntervalMs: DAY, now: NOW })), "never synced")
    assert.equal(freshnessLabel(getDataSourceFreshness({ lastSuccessfulSyncAt: new Date(NOW.getTime() - 2 * HOUR), expectedIntervalMs: DAY, now: NOW })), "fresh (2 h old)")
    assert.equal(freshnessLabel(getDataSourceFreshness({ lastSuccessfulSyncAt: new Date(NOW.getTime() - 31 * HOUR), expectedIntervalMs: DAY, now: NOW })), "stale (31 h old)")
    assert.equal(freshnessLabel(getDataSourceFreshness({ lastSuccessfulSyncAt: new Date(NOW.getTime() - 10 * 60_000), expectedIntervalMs: DAY, now: NOW })), "fresh (under an hour old)")
  })
})

describe("getSyncExecutionState", () => {
  test("idle, syncing, failed", () => {
    assert.equal(getSyncExecutionState(undefined), "idle")
    assert.equal(getSyncExecutionState({ status: "success" }), "idle")
    assert.equal(getSyncExecutionState({ status: "running" }), "syncing")
    assert.equal(getSyncExecutionState({ status: "failed" }), "failed")
    assert.equal(getSyncExecutionState({ status: "partial" }), "failed")
  })
})

describe("schedule config", () => {
  test("the committed cadence is daily in UTC, deployable on the Hobby plan", () => {
    assert.equal(SCHEDULED_SYNC_CRON, "0 3 * * *")
    assert.equal(SCHEDULED_SYNC_TIME_ZONE, "UTC")
    assert.deepEqual(DEFAULT_SCHEDULE_CONFIG, { expectedIntervalMs: DAY, graceMs: 3 * HOUR, minIntervalMs: 30 * 60_000, timeBudgetMs: 4 * 60_000, staleLockMs: 15 * 60_000 })
    assert.ok(DEFAULT_SCHEDULE_CONFIG.timeBudgetMs < 300_000, "budget stays under the 300 s function limit")
  })

  test("environment overrides in minutes, ignoring junk", () => {
    const c = readScheduleConfig({ SYNC_EXPECTED_INTERVAL_MINUTES: "360", SYNC_MIN_INTERVAL_MINUTES: "x", SYNC_TIME_BUDGET_MINUTES: "-1" })
    assert.equal(c.expectedIntervalMs, 6 * HOUR)
    assert.equal(c.minIntervalMs, 30 * 60_000)
    assert.equal(c.timeBudgetMs, 4 * 60_000)
  })
})
