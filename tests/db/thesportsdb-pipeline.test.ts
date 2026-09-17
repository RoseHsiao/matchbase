import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"

import { createSyncRepository } from "../../lib/data/repositories/sync-ops"
import { createTheSportsDbProvider } from "../../lib/data/sync/providers/thesportsdb"
import { runSync } from "../../lib/data/sync/sync-core"
import type { Provider } from "../../lib/data/sync/types"
import { PrismaClient, type Prisma } from "../../lib/generated/prisma/client"
import { configured, fakeApi, NOW, source, SOURCE_ID } from "../sync/fixtures/thesportsdb"

/**
 * The TheSportsDB adapter through the real pipeline into PostgreSQL, inside
 * rolled-back transactions, fed by fixtures. Proves what the manual sync
 * proves against the live API, without the network: rows are owned by the
 * data source, participants are two team sides, and a second run updates in
 * place. Skipped when no database URL is configured.
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

describeDb("TheSportsDB pipeline against PostgreSQL", () => {
  let prisma: PrismaClient
  before(() => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) })
  })
  after(async () => {
    await prisma.$disconnect()
  })

  /** Removes everything this source owns, so the case starts from "never synced" even on a database the manual sync has populated. Rolled back with the rest. */
  async function forgetSource(tx: Prisma.TransactionClient): Promise<void> {
    await tx.matchParticipant.deleteMany({ where: { match: { dataSourceId: SOURCE_ID } } })
    await tx.match.deleteMany({ where: { dataSourceId: SOURCE_ID } })
    await tx.season.deleteMany({ where: { league: { dataSourceId: SOURCE_ID } } })
    await tx.team.deleteMany({ where: { dataSourceId: SOURCE_ID } })
    await tx.venue.deleteMany({ where: { dataSourceId: SOURCE_ID } })
    await tx.league.deleteMany({ where: { dataSourceId: SOURCE_ID } })
  }

  async function rolledBack(body: (tx: Prisma.TransactionClient) => Promise<void>): Promise<void> {
    await prisma
      .$transaction(
        async (tx) => {
          await forgetSource(tx)
          await body(tx)
          throw new Rollback()
        },
        { timeout: 120_000, maxWait: 30_000 }
      )
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error
      })
  }

  const provider = (options: Parameters<typeof fakeApi>[0] = {}) => createTheSportsDbProvider(source, { config: configured(), request: fakeApi(options).request }) as Provider<never>

  it("creates the league, season, teams, venues and matches owned by the source, with home as side A and away as side B", async () => {
    await rolledBack(async (tx) => {
      const repository = createSyncRepository(tx)
      const result = await runSync(repository, SOURCE_ID, { now: NOW, resolveProvider: () => provider() })
      assert.equal(result.status, "SUCCESS", result.error)
      assert.equal(result.counts.leagues.created, 1)
      assert.equal(result.counts.matches.created, 7)
      const league = await tx.league.findUniqueOrThrow({ where: { dataSourceId_externalId: { dataSourceId: SOURCE_ID, externalId: "4328" } } })
      assert.equal(league.sportId, "football")
      assert.equal(league.shortName, "Premier League")
      const match = await tx.match.findUniqueOrThrow({ where: { dataSourceId_externalId: { dataSourceId: SOURCE_ID, externalId: "2494036" } }, include: { participants: { include: { team: true }, orderBy: { side: "asc" } } } })
      assert.equal(match.startsAt.toISOString(), "2026-09-14T19:00:00.000Z")
      assert.equal(match.status, "FINISHED")
      assert.deepEqual([match.sideAScore, match.sideBScore], [4, 1])
      assert.deepEqual(match.participants.map((p) => [p.side, p.team?.externalId, p.team?.name, p.playerId]), [["A", "133635", "Leeds United", null], ["B", "134777", "Newcastle United", null]])
      assert.ok(match.participants.every((p) => p.team?.dataSourceId === SOURCE_ID), "participants reference provider-owned teams, never demo teams")
      const demoArsenal = await tx.team.findUnique({ where: { id: "arsenal" } })
      const providerArsenal = await tx.team.findUnique({ where: { dataSourceId_externalId: { dataSourceId: SOURCE_ID, externalId: "133604" } } })
      assert.ok(demoArsenal && providerArsenal && demoArsenal.id !== providerArsenal.id, "the demo Arsenal and the provider Arsenal are different rows")
    })
  })

  it("a second run with the same fixtures updates every row in place and creates nothing", async () => {
    await rolledBack(async (tx) => {
      const repository = createSyncRepository(tx)
      const first = await runSync(repository, SOURCE_ID, { now: NOW, resolveProvider: () => provider() })
      const ids = await tx.match.findMany({ where: { dataSourceId: SOURCE_ID }, select: { id: true, externalId: true }, orderBy: { externalId: "asc" } })
      const second = await runSync(repository, SOURCE_ID, { now: new Date(NOW.getTime() + 3_600_000), resolveProvider: () => provider() })
      assert.equal(second.status, "SUCCESS", second.error)
      for (const kind of ["leagues", "seasons", "teams", "venues", "matches"] as const) {
        assert.equal(second.counts[kind].created, 0, kind)
        assert.equal(second.counts[kind].updated, first.counts[kind].created, kind)
      }
      const again = await tx.match.findMany({ where: { dataSourceId: SOURCE_ID }, select: { id: true, externalId: true }, orderBy: { externalId: "asc" } })
      assert.deepEqual(again, ids)
      assert.equal(await tx.matchParticipant.count({ where: { match: { dataSourceId: SOURCE_ID } } }), 14)
    })
  })

  it("a malformed event fails alone and the run is PARTIAL with the id in the log", async () => {
    await rolledBack(async (tx) => {
      const { fakeApi: api, broken } = await import("../sync/fixtures/thesportsdb")
      const p = createTheSportsDbProvider(source, { config: configured(), request: api({ days: { "2026-09-16": [broken.noTime] } }).request }) as Provider<never>
      const result = await runSync(createSyncRepository(tx), SOURCE_ID, { now: NOW, resolveProvider: () => p })
      assert.equal(result.status, "PARTIAL")
      assert.equal(result.counts.matches.failed, 1)
      assert.ok(result.counts.matches.created > 0)
      const log = await tx.syncLog.findUniqueOrThrow({ where: { id: result.syncLogId! } })
      assert.equal(log.status, "PARTIAL")
      assert.match(log.error ?? "", /9000001/)
    })
  })
})
