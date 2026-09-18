import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { manualSyncPolicy, type ManualSyncRun } from "../../lib/data/sync/manual-sync-policy"

const now = new Date("2026-09-18T10:00:00Z")
const minutes = (n: number) => new Date(now.getTime() - n * 60_000)
const COOLDOWN = 10 * 60_000
const run = (status: ManualSyncRun["status"], minutesAgo: number): ManualSyncRun => ({ status, startedAt: minutes(minutesAgo) })

describe("manualSyncPolicy (Admin Sync now cooldown)", () => {
  it("allows a source with no runs", () => {
    assert.deepEqual(manualSyncPolicy({ runs: [], now, cooldownMs: COOLDOWN }), { allowed: true })
  })
  it("refuses while the last successful run is younger than the cooldown", () => {
    const verdict = manualSyncPolicy({ runs: [run("SUCCESS", 3)], now, cooldownMs: COOLDOWN })
    assert.equal(verdict.allowed, false)
    if (verdict.allowed) return
    assert.equal(verdict.retryAfterMs, 7 * 60_000)
    assert.match(verdict.reason, /synced successfully 3 min ago/)
    assert.match(verdict.reason, /Try again in 7 min/)
    assert.equal(manualSyncPolicy({ runs: [run("PARTIAL", 9)], now, cooldownMs: COOLDOWN }).allowed, false, "partial counts as success for the cooldown")
  })
  it("allows once the cooldown has elapsed, exactly at the boundary", () => {
    assert.equal(manualSyncPolicy({ runs: [run("SUCCESS", 10)], now, cooldownMs: COOLDOWN }).allowed, true)
    assert.equal(manualSyncPolicy({ runs: [run("SUCCESS", 9.99)], now, cooldownMs: COOLDOWN }).allowed, false)
  })
  it("always allows a retry after a failed run (operator recovery)", () => {
    assert.equal(manualSyncPolicy({ runs: [run("FAILED", 1), run("SUCCESS", 2)], now, cooldownMs: COOLDOWN }).allowed, true)
  })
  it("leaves a RUNNING latest run to the database lock", () => {
    assert.equal(manualSyncPolicy({ runs: [run("RUNNING", 1), run("SUCCESS", 2)], now, cooldownMs: COOLDOWN }).allowed, true)
  })
  it("uses the newest success even when older failures follow it in history", () => {
    assert.equal(manualSyncPolicy({ runs: [run("SUCCESS", 2), run("FAILED", 5), run("SUCCESS", 30)], now, cooldownMs: COOLDOWN }).allowed, false)
  })
  it("a zero cooldown disables the gate", () => {
    assert.equal(manualSyncPolicy({ runs: [run("SUCCESS", 0)], now, cooldownMs: 0 }).allowed, true)
  })
})
