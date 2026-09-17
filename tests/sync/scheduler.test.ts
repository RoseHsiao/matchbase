import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { isSchedulable, runScheduledSyncs, type SchedulerDeps, type SchedulerSource } from "../../lib/data/sync/scheduler"
import type { Provider, SyncResult } from "../../lib/data/sync/types"

const NOW = new Date("2026-09-17T03:00:00Z")

function provider(overrides: Partial<Provider<never>> = {}): Provider<never> {
  return { key: "p", name: "P", sport: "football", kind: "live", checkConfiguration: () => ({ configured: true }), fetch: async () => undefined as never, normalize: () => ({ leagues: [], seasons: [], teams: [], players: [], venues: [], matches: [], issues: [] }), ...overrides }
}

function result(id: string, status: SyncResult["status"], extra: Partial<SyncResult> = {}): SyncResult {
  const zero = { created: 0, updated: 0, failed: 0 }
  return { dataSourceId: id, provider: "p", status, records: 5, durationMs: 10, counts: { leagues: zero, seasons: zero, teams: zero, players: zero, venues: zero, matches: zero }, issues: [], syncLogId: `log-${id}`, ...extra }
}

const sources: SchedulerSource[] = [
  { id: "live-ok", name: "Live OK", status: "ACTIVE", lastSyncedAt: null },
  { id: "live-unconfigured", name: "Live unconfigured", status: "ACTIVE", lastSyncedAt: null },
  { id: "mock", name: "Mock feed", status: "ACTIVE", lastSyncedAt: null },
  { id: "disabled", name: "Disabled live", status: "INACTIVE", lastSyncedAt: null },
  { id: "unbound", name: "Placeholder", status: "ACTIVE", lastSyncedAt: null },
  { id: "live-recent", name: "Live recent", status: "ACTIVE", lastSyncedAt: new Date(NOW.getTime() - 5 * 60_000) },
  { id: "live-failing", name: "Live failing", status: "ACTIVE", lastSyncedAt: new Date(NOW.getTime() - 48 * 3_600_000) },
]

const providers: Record<string, Provider<never> | undefined> = {
  "live-ok": provider(),
  "live-unconfigured": provider({ checkConfiguration: () => ({ configured: false, error: "API key missing" }) }),
  mock: provider({ kind: "mock" }),
  disabled: provider(),
  unbound: undefined,
  "live-recent": provider(),
  "live-failing": provider(),
}

function deps(overrides: Partial<SchedulerDeps> = {}, calls: string[] = []): { deps: SchedulerDeps; calls: string[] } {
  return {
    calls,
    deps: {
      listSources: async () => sources,
      resolveProvider: (id) => providers[id],
      sync: async (id) => {
        calls.push(id)
        if (id === "live-failing") return result(id, "FAILED", { records: 0, error: "Provider rejected the request: HTTP 500", errorKind: "server" })
        return result(id, "SUCCESS")
      },
      ...overrides,
    },
  }
}

describe("isSchedulable", () => {
  it("accepts an active source with a configured live provider only", () => {
    assert.deepEqual(isSchedulable({ status: "ACTIVE" }, providers["live-ok"]), { eligible: true })
    assert.match((isSchedulable({ status: "INACTIVE" }, providers["live-ok"]) as { reason: string }).reason, /disabled/)
    assert.match((isSchedulable({ status: "ACTIVE" }, undefined) as { reason: string }).reason, /no provider/)
    assert.match((isSchedulable({ status: "ACTIVE" }, providers.mock) as { reason: string }).reason, /mock provider/)
    assert.match((isSchedulable({ status: "ACTIVE" }, providers["live-unconfigured"]) as { reason: string }).reason, /not configured: API key missing/)
  })
})

describe("runScheduledSyncs", () => {
  it("discovers eligible sources, ignores the rest, and says why", async () => {
    const d = deps()
    const summary = await runScheduledSyncs({ trigger: "test", now: NOW }, d.deps)
    assert.deepEqual(d.calls.sort(), ["live-failing", "live-ok", "live-recent"])
    const byId = Object.fromEntries(summary.sources.map((s) => [s.id, s]))
    assert.equal(byId["live-ok"].outcome, "SUCCESS")
    assert.equal(byId.mock.outcome, "INELIGIBLE")
    assert.match(byId.mock.reason ?? "", /mock/)
    assert.equal(byId.disabled.outcome, "INELIGIBLE")
    assert.equal(byId.unbound.outcome, "INELIGIBLE")
    assert.equal(byId["live-unconfigured"].outcome, "INELIGIBLE")
    assert.match(byId["live-unconfigured"].reason ?? "", /API key missing/)
  })

  it("one source failing does not stop the others, and the summary counts every outcome", async () => {
    const d = deps()
    const summary = await runScheduledSyncs({ trigger: "cron", now: NOW }, d.deps)
    const byId = Object.fromEntries(summary.sources.map((s) => [s.id, s]))
    assert.equal(byId["live-failing"].outcome, "FAILED")
    assert.match(byId["live-failing"].reason ?? "", /HTTP 500/)
    assert.equal(byId["live-ok"].outcome, "SUCCESS")
    assert.equal(byId["live-ok"].syncLogId, "log-live-ok")
    assert.deepEqual(summary.counts, { SUCCESS: 2, PARTIAL: 0, FAILED: 1, SKIPPED_LOCKED: 0, SKIPPED_RECENT: 0, SKIPPED_BUDGET: 0, INELIGIBLE: 4 })
    assert.equal(summary.trigger, "cron")
    assert.equal(summary.startedAt, NOW.toISOString())
    assert.equal(summary.sources.length, sources.length)
  })

  it("a thrown error from the pipeline is isolated as a FAILED outcome", async () => {
    const d = deps({ sync: async (id) => { if (id === "live-ok") throw new Error("boom"); return result(id, "SUCCESS") } })
    const summary = await runScheduledSyncs({ trigger: "test", now: NOW }, d.deps)
    const byId = Object.fromEntries(summary.sources.map((s) => [s.id, s]))
    assert.equal(byId["live-ok"].outcome, "FAILED")
    assert.equal(byId["live-ok"].reason, "boom")
    assert.equal(byId["live-recent"].outcome, "SUCCESS")
  })

  it("a locked source is reported as SKIPPED_LOCKED, not as a failure", async () => {
    const d = deps({ sync: async (id) => (id === "live-ok" ? result(id, "SKIPPED", { records: 0, error: "A sync started at 2026-09-17T02:59:00.000Z is still running; skipped.", errorKind: "locked" }) : result(id, "SUCCESS")) })
    const summary = await runScheduledSyncs({ trigger: "cron", now: NOW }, d.deps)
    const byId = Object.fromEntries(summary.sources.map((s) => [s.id, s]))
    assert.equal(byId["live-ok"].outcome, "SKIPPED_LOCKED")
    assert.equal(summary.counts.SKIPPED_LOCKED, 1)
    assert.equal(summary.counts.SUCCESS, 2)
    assert.equal(summary.counts.FAILED, 0)
  })

  it("the recency gate skips a source synced more recently than the minimum interval (duplicate cron deliveries)", async () => {
    const d = deps()
    const summary = await runScheduledSyncs({ trigger: "cron", now: NOW, minIntervalMs: 30 * 60_000 }, d.deps)
    const byId = Object.fromEntries(summary.sources.map((s) => [s.id, s]))
    assert.equal(byId["live-recent"].outcome, "SKIPPED_RECENT")
    assert.match(byId["live-recent"].reason ?? "", /5 min ago/)
    assert.ok(!d.calls.includes("live-recent"))
    assert.ok(d.calls.includes("live-ok"), "never-synced sources always run")
    assert.ok(d.calls.includes("live-failing"), "a source synced 48 h ago runs")
  })

  it("the time budget stops starting sources once exhausted", async () => {
    const d = deps({ sync: async (id) => { await new Promise((r) => setTimeout(r, 300)); return result(id, "SUCCESS") } })
    const summary = await runScheduledSyncs({ trigger: "cron", now: NOW, timeBudgetMs: 200 }, d.deps)
    assert.equal(summary.counts.SUCCESS, 1, "only the first eligible source started")
    assert.equal(summary.counts.SKIPPED_BUDGET, 2)
    assert.equal(summary.sources.find((s) => s.id === "live-recent")?.outcome, "SKIPPED_BUDGET")
  })

  it("runs sources sequentially in listing order", async () => {
    const order: string[] = []
    let active = 0
    const d = deps({ sync: async (id) => { active++; assert.equal(active, 1, "no concurrent source runs"); order.push(id); await new Promise((r) => setTimeout(r, 5)); active--; return result(id, "SUCCESS") } })
    await runScheduledSyncs({ trigger: "test", now: NOW }, d.deps)
    assert.deepEqual(order, ["live-ok", "live-recent", "live-failing"])
  })
})
