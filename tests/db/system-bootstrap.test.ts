import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { after, describe, it } from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"

import { applySystemBootstrap } from "../../lib/data/repositories/system-bootstrap-ops"
import { PrismaClient } from "../../lib/generated/prisma/client"
import { lockSharedCatalogue } from "./shared-catalogue-lock"

/**
 * The system bootstrap against the real database, inside a rolled-back
 * transaction: on a schema where the rows already exist it changes nothing
 * destructive; where a source is missing it creates it ACTIVE; a disabled
 * source stays disabled on re-run. Skipped without a database URL.
 */

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file)
}
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

class Rollback extends Error {}

describeDb("system bootstrap (database)", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) })

  after(async () => {
    await prisma.$disconnect()
  })

  async function rolledBack(work: (tx: Parameters<typeof applySystemBootstrap>[0] & { syncLog: PrismaClient["syncLog"]; league: PrismaClient["league"] }) => Promise<void>) {
    await prisma
      .$transaction(
        async (tx) => {
          await lockSharedCatalogue(tx)
          await work(tx as never)
          throw new Rollback()
        },
        { timeout: 60_000, maxWait: 10_000 }
      )
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error
      })
  }

  it("creates missing rows and leaves existing ones intact; re-runs are idempotent", async () => {
    await rolledBack(async (tx) => {
      // Simulate a source that a fresh database would not have yet.
      await tx.syncLog.deleteMany({ where: { dataSourceId: "ds-tennis-sportradar" } })
      await tx.league.updateMany({ where: { dataSourceId: "ds-tennis-sportradar" }, data: { dataSourceId: null } })
      await tx.dataSource.deleteMany({ where: { id: "ds-tennis-sportradar" } })
      const first = await applySystemBootstrap(tx)
      assert.equal(first.dataSources.created, 1)
      assert.equal(first.dataSources.updated, 1)
      assert.equal(first.sports.created + first.sports.updated, 6)
      const created = await tx.dataSource.findUniqueOrThrow({ where: { id: "ds-tennis-sportradar" } })
      assert.equal(created.status, "ACTIVE")
      assert.equal(created.sportId, "tennis")
      const second = await applySystemBootstrap(tx)
      assert.deepEqual(second, { sports: { created: 0, updated: 6 }, dataSources: { created: 0, updated: 2 } })
    })
  })

  it("preserves an administrator's disabled status and lastSyncedAt on re-run", async () => {
    await rolledBack(async (tx) => {
      const when = new Date("2026-09-01T00:00:00Z")
      await tx.dataSource.update({ where: { id: "ds-thesportsdb-epl" }, data: { status: "INACTIVE", lastSyncedAt: when } })
      await applySystemBootstrap(tx)
      const row = await tx.dataSource.findUniqueOrThrow({ where: { id: "ds-thesportsdb-epl" } })
      assert.equal(row.status, "INACTIVE")
      assert.equal(row.lastSyncedAt?.toISOString(), when.toISOString())
      assert.equal(row.name, "TheSportsDB · Premier League")
    })
  })

  it("does not create the mock feed unless asked", async () => {
    await rolledBack(async (tx) => {
      await tx.syncLog.deleteMany({ where: { dataSourceId: "ds-mock-basketball" } })
      await tx.league.updateMany({ where: { dataSourceId: "ds-mock-basketball" }, data: { dataSourceId: null } })
      await tx.dataSource.deleteMany({ where: { id: "ds-mock-basketball" } })
      await applySystemBootstrap(tx)
      assert.equal(await tx.dataSource.count({ where: { id: "ds-mock-basketball" } }), 0)
      await applySystemBootstrap(tx, { includeMock: true })
      assert.equal(await tx.dataSource.count({ where: { id: "ds-mock-basketball" } }), 1)
    })
  })
})
