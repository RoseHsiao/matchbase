import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"

import { loadDataSourcesWithRuns } from "../../lib/data/repositories/monitoring-ops"
import { createSyncRepository } from "../../lib/data/repositories/sync-ops"
import { consecutiveFailures, evaluateSourceHealth, RECENT_RUNS } from "../../lib/data/sync/health"
import { runSync } from "../../lib/data/sync/sync-core"
import type { NormalizedSnapshot, Provider } from "../../lib/data/sync/types"
import { PrismaClient, type Prisma } from "../../lib/generated/prisma/client"

/**
 * The bounded recent-history read and the health it feeds, against a real
 * PostgreSQL inside a rolled-back transaction. Temporary sources and logs
 * only; no provider is contacted; nothing persists.
 */

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file)
  } catch {
    // optional
  }
}
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip
class Rollback extends Error {}

const schedule = { expectedIntervalMs: 24 * 3_600_000, graceMs: 3 * 3_600_000, staleLockMs: 15 * 60_000 }

describeDb("monitoring: recent runs from PostgreSQL", () => {
  let prisma: PrismaClient
  before(() => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) })
  })
  after(async () => {
    await prisma.$disconnect()
  })

  async function rolledBack(body: (tx: Prisma.TransactionClient) => Promise<void>): Promise<void> {
    await prisma.$transaction(async (tx) => { await body(tx); throw new Rollback() }, { timeout: 120_000, maxWait: 30_000 }).catch((e: unknown) => { if (!(e instanceof Rollback)) throw e })
  }

  const NOW = new Date("2026-09-18T12:00:00Z")
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

  it("loads every source once with at most RECENT_RUNS newest-first runs, and derives latest, last success and streak correctly", async () => {
    await rolledBack(async (tx) => {
      await tx.dataSource.createMany({ data: [{ id: "ds-mon-a", name: "Mon A", sportId: "football" }, { id: "ds-mon-b", name: "Mon B", sportId: "football" }] })
      // A: 14 runs, the newest two failed, then a partial, then successes; B: none.
      const logs = []
      for (let i = 0; i < 14; i++) {
        const status = i === 0 || i === 1 ? "FAILED" : i === 2 ? "PARTIAL" : "SUCCESS"
        logs.push({ dataSourceId: "ds-mon-a", entity: "all", records: status === "FAILED" ? 0 : 40 + i, status, durationMs: 1000 + i, startedAt: hoursAgo(i + 1), error: status === "FAILED" ? (i === 0 ? "Abandoned: the run did not finish within 15 minutes and was marked failed by a later run." : "Provider server error (retries exhausted): HTTP 503 from https://p.test/x?api_key=abc") : status === "PARTIAL" ? "ERROR match 1: bad\nWARNING match 2: odd" : null })
      }
      await tx.syncLog.createMany({ data: logs as never })
      await tx.dataSource.update({ where: { id: "ds-mon-a" }, data: { lastSyncedAt: hoursAgo(3) } })

      const sources = await loadDataSourcesWithRuns(tx)
      const ids = sources.map((s) => s.id)
      assert.equal(new Set(ids).size, ids.length, "no duplicate sources")
      const a = sources.find((s) => s.id === "ds-mon-a")!
      const b = sources.find((s) => s.id === "ds-mon-b")!
      assert.equal(a.recentRuns.length, RECENT_RUNS, "bounded to RECENT_RUNS even though 14 exist")
      assert.ok(a.recentRuns.every((r, i, arr) => i === 0 || arr[i - 1].at >= r.at), "newest first")
      assert.equal(a.recentRuns[0].category, "abandoned")
      assert.equal(a.recentRuns[1].category, "server")
      assert.equal(a.recentRuns[2].status, "partial")
      assert.equal(a.recentRuns[2].errorCount, 1)
      assert.equal(a.recentRuns[2].warningCount, 1)
      assert.equal(consecutiveFailures(a.recentRuns, NOW, schedule.staleLockMs), 2)
      assert.deepEqual(b.recentRuns, [])

      const health = evaluateSourceHealth({ enabled: true, provider: { kind: "live", configured: true }, lastSuccessfulSyncAt: a.lastSyncedAt?.toISOString(), recentRuns: a.recentRuns, now: NOW, schedule })
      assert.equal(health.state, "failing")
      assert.equal(health.lastSuccess?.status, "partial", "last success is the most recent SUCCESS or PARTIAL")
      assert.equal(health.latestRun?.category, "abandoned")
      const fresh = evaluateSourceHealth({ enabled: true, provider: { kind: "live", configured: true }, lastSuccessfulSyncAt: b.lastSyncedAt?.toISOString(), recentRuns: b.recentRuns, now: NOW, schedule })
      assert.equal(fresh.state, "never-synced")
    })
  })

  it("a PARTIAL run leaves the source fresh and degraded, and the stored issue text explains why", async () => {
    await rolledBack(async (tx) => {
      await tx.dataSource.create({ data: { id: "ds-mon-c", name: "Mon C", sportId: "football" } })
      const empty = (): NormalizedSnapshot => ({ leagues: [], seasons: [], teams: [], players: [], venues: [], matches: [], issues: [] })
      const partialProvider: Provider<never> = { key: "mon", name: "Mon", sport: "football", kind: "live", checkConfiguration: () => ({ configured: true }), fetch: async () => undefined as never, normalize: () => ({ ...empty(), leagues: [{ externalId: "L1", sport: "football", name: "Mon League", shortName: "MONL" }], issues: [{ level: "error", entity: "match", externalId: "m-bad", message: "Event has no usable start time." }] }) }
      const result = await runSync(createSyncRepository(tx), "ds-mon-c", { now: NOW, resolveProvider: () => partialProvider })
      assert.equal(result.status, "PARTIAL")
      const [c] = (await loadDataSourcesWithRuns(tx)).filter((s) => s.id === "ds-mon-c")
      assert.equal(c.recentRuns[0].status, "partial")
      assert.equal(c.recentRuns[0].category, "issues")
      assert.equal(c.recentRuns[0].errorCount, 1)
      const health = evaluateSourceHealth({ enabled: true, provider: { kind: "live", configured: true }, lastSuccessfulSyncAt: c.lastSyncedAt?.toISOString(), recentRuns: c.recentRuns, now: NOW, schedule })
      assert.equal(health.state, "degraded")
      assert.equal(health.freshness.state, "fresh")
      assert.match(health.reasons[0], /1 record error/)
    })
  })

  it("the persistence boundary redacts secrets from a failing provider's message", async () => {
    await rolledBack(async (tx) => {
      await tx.dataSource.create({ data: { id: "ds-mon-d", name: "Mon D", sportId: "football" } })
      const leaky: Provider<never> = { key: "leaky", name: "Leaky", sport: "football", kind: "live", checkConfiguration: () => ({ configured: true }), fetch: async () => { throw new Error("HTTP 500 from https://p.test/x?api_key=very-secret-key-1 with Authorization: Bearer very-secret-key-1 and postgres://u:dbpass@h/db") }, normalize: () => ({ leagues: [], seasons: [], teams: [], players: [], venues: [], matches: [], issues: [] }) }
      const result = await runSync(createSyncRepository(tx), "ds-mon-d", { now: NOW, resolveProvider: () => leaky, env: { LEAKY_API_KEY: "very-secret-key-1" } })
      assert.equal(result.status, "FAILED")
      const log = await tx.syncLog.findUniqueOrThrow({ where: { id: result.syncLogId! } })
      assert.ok(!log.error!.includes("very-secret-key-1"), "key scrubbed before persistence")
      assert.ok(!log.error!.includes("dbpass"), "db password scrubbed before persistence")
      assert.ok(!result.error!.includes("very-secret-key-1"), "and from the returned result")
      const [d] = (await loadDataSourcesWithRuns(tx)).filter((s) => s.id === "ds-mon-d")
      assert.ok(!JSON.stringify(d).includes("very-secret-key-1"), "monitoring rows carry no secret")
      assert.equal(d.recentRuns[0].category, "failed", "a plain thrown error is a generic failure; HttpError would be 'server'")
    })
  })
})
