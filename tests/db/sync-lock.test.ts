import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"

import { createSyncRepository } from "../../lib/data/repositories/sync-ops"
import { runSync } from "../../lib/data/sync/sync-core"
import type { NormalizedSnapshot, Provider } from "../../lib/data/sync/types"
import { PrismaClient } from "../../lib/generated/prisma/client"

/**
 * The per-source run lock against a real PostgreSQL, from two independent
 * clients (two connections, as two serverless invocations would be). Uses
 * temporary DataSource rows created for the test and removed afterwards
 * (their sync logs cascade), so nothing else in the database is touched and
 * no provider is contacted. Skipped without a database URL.
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

const empty = (): NormalizedSnapshot => ({ leagues: [], seasons: [], teams: [], players: [], venues: [], matches: [], issues: [] })

/** A provider whose fetch takes `delayMs`, or throws when `fail` is set. */
function slowProvider(delayMs: number, fail = false): Provider<never> {
  return {
    key: "lock-test",
    name: "Lock test",
    sport: "football",
    kind: "live",
    checkConfiguration: () => ({ configured: true }),
    fetch: async () => {
      await new Promise((r) => setTimeout(r, delayMs))
      if (fail) throw new Error("simulated provider failure")
      return undefined as never
    },
    normalize: empty,
  }
}

describeDb("sync run lock (database-backed)", () => {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const A = `ds-locktest-a-${suffix}`
  const B = `ds-locktest-b-${suffix}`
  let one: PrismaClient
  let two: PrismaClient
  const repo = (client: PrismaClient) => createSyncRepository(client, { transaction: (work) => client.$transaction((tx) => work(tx), { timeout: 15_000 }) })

  before(async () => {
    one = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) })
    two = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) })
    await one.dataSource.createMany({ data: [{ id: A, name: "Lock test A", sportId: "football" }, { id: B, name: "Lock test B", sportId: "football" }] })
  })
  after(async () => {
    await one.dataSource.deleteMany({ where: { id: { in: [A, B] } } })
    await one.$disconnect()
    await two.$disconnect()
  })

  it("acquires the lock and releases it on success", async () => {
    const result = await runSync(repo(one), A, { resolveProvider: () => slowProvider(10) })
    assert.equal(result.status, "SUCCESS")
    assert.equal(await one.syncLog.count({ where: { dataSourceId: A, status: "RUNNING" } }), 0)
    const log = await one.syncLog.findUniqueOrThrow({ where: { id: result.syncLogId! } })
    assert.equal(log.status, "SUCCESS")
  })

  it("a concurrent second invocation from another connection skips the same source", async () => {
    const first = runSync(repo(one), A, { resolveProvider: () => slowProvider(1500) })
    await new Promise((r) => setTimeout(r, 400))
    const second = await runSync(repo(two), A, { resolveProvider: () => slowProvider(10) })
    assert.equal(second.status, "SKIPPED")
    assert.equal(second.errorKind, "locked")
    assert.match(second.error ?? "", /still running/)
    const done = await first
    assert.equal(done.status, "SUCCESS")
    assert.equal(second.syncLogId, done.syncLogId, "the skip points at the run that held the lock")
    assert.equal(await one.syncLog.count({ where: { dataSourceId: A } }), 2, "the skip wrote no log row")
  })

  it("two truly simultaneous acquisitions let exactly one through", async () => {
    const [x, y] = await Promise.all([runSync(repo(one), A, { resolveProvider: () => slowProvider(600) }), runSync(repo(two), A, { resolveProvider: () => slowProvider(600) })])
    const statuses = [x.status, y.status].sort()
    assert.deepEqual(statuses, ["SKIPPED", "SUCCESS"])
  })

  it("releases the lock after a failure", async () => {
    const failed = await runSync(repo(one), A, { resolveProvider: () => slowProvider(10, true) })
    assert.equal(failed.status, "FAILED")
    assert.equal(await one.syncLog.count({ where: { dataSourceId: A, status: "RUNNING" } }), 0)
    const next = await runSync(repo(two), A, { resolveProvider: () => slowProvider(10) })
    assert.equal(next.status, "SUCCESS")
  })

  it("recovers a stale lock left by a dead process", async () => {
    const stale = await one.syncLog.create({ data: { dataSourceId: A, entity: "all", records: 0, status: "RUNNING", startedAt: new Date(Date.now() - 20 * 60_000) } })
    const blocked = await runSync(repo(two), A, { resolveProvider: () => slowProvider(10), staleLockMs: 60 * 60_000 })
    assert.equal(blocked.status, "SKIPPED", "younger than the stale threshold: still locked")
    const recovered = await runSync(repo(two), A, { resolveProvider: () => slowProvider(10), staleLockMs: 15 * 60_000 })
    assert.equal(recovered.status, "SUCCESS", "older than the threshold: taken over")
    assert.ok(recovered.issues.some((i) => /abandoned run/.test(i.message)))
    const abandoned = await one.syncLog.findUniqueOrThrow({ where: { id: stale.id } })
    assert.equal(abandoned.status, "FAILED")
    assert.match(abandoned.error ?? "", /Abandoned/)
  })

  it("different sources do not block each other", async () => {
    const [a, b] = await Promise.all([runSync(repo(one), A, { resolveProvider: () => slowProvider(800) }), runSync(repo(two), B, { resolveProvider: () => slowProvider(800) })])
    assert.equal(a.status, "SUCCESS")
    assert.equal(b.status, "SUCCESS")
  })
})
