import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { after, describe, it } from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"

import { createSyncRepository, type SyncClient } from "../../lib/data/repositories/sync-ops"
import { mockBasketballProvider } from "../../lib/data/sync/providers/mock-basketball"
import { createSportradarTennisProvider } from "../../lib/data/sync/providers/sportradar-tennis"
import { runSync } from "../../lib/data/sync/sync-core"
import type { Provider } from "../../lib/data/sync/types"
import { HttpError } from "../../lib/data/sync/utils/http"
import { PrismaClient } from "../../lib/generated/prisma/client"
import { lockSharedCatalogue } from "./shared-catalogue-lock"
import { broken, configured, doublesLive, fakeApi, NOW, singlesClosed } from "../sync/fixtures/sportradar-tennis"

/**
 * End-to-end pipeline without credentials:
 *
 *   fixture response → provider fetch (in-memory transport) → normalize →
 *   participant conversion → repository persistence → PostgreSQL rows
 *
 * Every case runs inside a transaction that is rolled back, so the database
 * is left exactly as it was. Skipped when no database URL is configured.
 * No network is used anywhere: the "live" tennis provider is driven by the
 * same fixture transport the unit tests use.
 */

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file)
}
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

class Rollback extends Error {}

const TENNIS_SOURCE = "ds-tennis-sportradar"
const BASKETBALL_SOURCE = "ds-mock-basketball"

describeDb("sync pipeline (database, fixtures, no credentials)", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) })

  after(async () => {
    await prisma.$disconnect()
  })

  async function withRollback(body: (tx: SyncClient) => Promise<void>): Promise<void> {
    await prisma
      .$transaction(
        async (tx) => {
          await lockSharedCatalogue(tx)
          await body(tx)
          throw new Rollback()
        },
        { timeout: 120_000, maxWait: 15_000 }
      )
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error
      })
  }

  const tennisWith = (summariesBySeason: Record<string, typeof singlesClosed[]>) => {
    const api = fakeApi(summariesBySeason)
    const provider = createSportradarTennisProvider({ config: configured(), request: api.request }) as Provider<never>
    return { provider, resolve: () => provider, calls: api.calls }
  }

  const fixtureSet = { "sr:season:130001": [singlesClosed], "sr:season:130002": [doublesLive] }

  it("persists tennis singles and doubles as participant rows with correct identity, sides, status, score, league, season and time", async () => {
    await withRollback(async (tx) => {
      const { resolve, calls } = tennisWith(fixtureSet)
      const result = await runSync(createSyncRepository(tx), TENNIS_SOURCE, { now: NOW, resolveProvider: resolve })
      assert.equal(result.status, "SUCCESS", JSON.stringify(result.issues))
      assert.equal(result.provider, "sportradar-tennis")
      assert.ok(calls.every((c) => !c.url.includes("test-key")), "the key never travels in a URL")
      assert.deepEqual(result.counts.leagues, { created: 3, updated: 0, failed: 0 })
      assert.deepEqual(result.counts.seasons, { created: 2, updated: 0, failed: 0 })
      assert.deepEqual(result.counts.players, { created: 6, updated: 0, failed: 0 })
      assert.deepEqual(result.counts.venues, { created: 1, updated: 0, failed: 0 })
      assert.deepEqual(result.counts.matches, { created: 2, updated: 0, failed: 0 })
      assert.deepEqual(result.counts.teams, { created: 0, updated: 0, failed: 0 }, "no fake teams")

      // External identity.
      const league = await tx.league.findUniqueOrThrow({ where: { dataSourceId_externalId: { dataSourceId: TENNIS_SOURCE, externalId: "sr:competition:2555" } } })
      assert.equal(league.sportId, "tennis")
      assert.equal(league.name, "Wimbledon Men Singles")
      const season = await tx.season.findUniqueOrThrow({ where: { leagueId_name: { leagueId: league.id, name: "2026" } } })
      assert.equal(season.startsAt.toISOString().slice(0, 10), "2026-06-29")

      // Players: provider ids, no team.
      const players = await tx.player.findMany({ where: { dataSourceId: TENNIS_SOURCE }, orderBy: { externalId: "asc" } })
      assert.equal(players.length, 6)
      assert.ok(players.every((p) => p.teamId === null), "tennis players have no team")
      assert.ok(players.every((p) => p.externalId?.startsWith("sr:competitor:")))
      const djokovic = players.find((p) => p.externalId === "sr:competitor:14882")
      assert.equal(djokovic?.name, "Novak Djokovic")
      assert.equal(djokovic?.nationality, "Serbia")

      // Singles: side A = provider home, side B = away, sets-won score, finished, UTC instant.
      const singles = await tx.match.findUniqueOrThrow({
        where: { dataSourceId_externalId: { dataSourceId: TENNIS_SOURCE, externalId: "sr:sport_event:50001" } },
        include: { participants: { include: { player: true }, orderBy: [{ side: "asc" }, { order: "asc" }] }, venue: true },
      })
      assert.equal(singles.leagueId, league.id)
      assert.equal(singles.seasonId, season.id)
      assert.equal(singles.status, "FINISHED")
      assert.equal(singles.sideAScore, 1)
      assert.equal(singles.sideBScore, 3)
      assert.equal(singles.startsAt.toISOString(), "2026-07-04T13:00:00.000Z")
      assert.equal(singles.stage, "Quarterfinal")
      assert.equal(singles.venue?.externalId, "sr:venue:1234")
      assert.deepEqual(singles.participants.map((p) => [p.side, p.order, p.player?.externalId, p.teamId]), [["A", 1, "sr:competitor:14882", null], ["B", 1, "sr:competitor:407573", null]])

      // Doubles: two players per side, provider "home" is side A regardless of array order, live with detail.
      const doubles = await tx.match.findUniqueOrThrow({
        where: { dataSourceId_externalId: { dataSourceId: TENNIS_SOURCE, externalId: "sr:sport_event:50002" } },
        include: { participants: { include: { player: true }, orderBy: [{ side: "asc" }, { order: "asc" }] } },
      })
      assert.equal(doubles.status, "LIVE")
      assert.equal(doubles.liveDetail, "Set 2")
      assert.deepEqual(doubles.participants.map((p) => `${p.side}${p.order}:${p.player?.externalId}`), ["A1:sr:competitor:53880", "A2:sr:competitor:51424", "B1:sr:competitor:38516", "B2:sr:competitor:36208"])
      assert.equal(doubles.sideAScore, 1)
      assert.equal(doubles.sideBScore, 0)

      // Sync log and data source.
      const log = await tx.syncLog.findUniqueOrThrow({ where: { id: result.syncLogId ?? "" } })
      assert.equal(log.status, "SUCCESS")
      assert.equal(log.records, result.records)
      assert.equal(log.entity, "all")
      assert.equal(log.error, null)
      const source = await tx.dataSource.findUniqueOrThrow({ where: { id: TENNIS_SOURCE } })
      assert.equal(source.lastSyncedAt?.toISOString(), NOW.toISOString())
    })
  })

  it("is idempotent: the same fixture twice creates nothing new and keeps every internal id", async () => {
    await withRollback(async (tx) => {
      const repository = createSyncRepository(tx)
      const first = await runSync(repository, TENNIS_SOURCE, { now: NOW, resolveProvider: tennisWith(fixtureSet).resolve })
      const snapshot = async () => ({
        leagues: await tx.league.findMany({ where: { dataSourceId: TENNIS_SOURCE }, select: { id: true, externalId: true }, orderBy: { externalId: "asc" } }),
        players: await tx.player.findMany({ where: { dataSourceId: TENNIS_SOURCE }, select: { id: true, externalId: true }, orderBy: { externalId: "asc" } }),
        matches: await tx.match.findMany({ where: { dataSourceId: TENNIS_SOURCE }, select: { id: true, externalId: true, participants: { select: { id: true, side: true, order: true, playerId: true }, orderBy: [{ side: "asc" }, { order: "asc" }] } }, orderBy: { externalId: "asc" } }),
        seasons: await tx.season.count({ where: { league: { dataSourceId: TENNIS_SOURCE } } }),
        venues: await tx.venue.count({ where: { dataSourceId: TENNIS_SOURCE } }),
      })
      const before = await snapshot()
      const second = await runSync(repository, TENNIS_SOURCE, { now: new Date(NOW.getTime() + 3_600_000), resolveProvider: tennisWith(fixtureSet).resolve })
      const afterRun = await snapshot()
      assert.equal(first.status, "SUCCESS")
      assert.equal(second.status, "SUCCESS")
      assert.deepEqual(second.counts.matches, { created: 0, updated: 2, failed: 0 })
      assert.deepEqual(second.counts.players, { created: 0, updated: 6, failed: 0 })
      assert.deepEqual(second.counts.leagues, { created: 0, updated: 3, failed: 0 })
      assert.deepEqual(afterRun, before, "no duplicates; internal ids and participant rows unchanged")
      assert.equal(await tx.syncLog.count({ where: { dataSourceId: TENNIS_SOURCE, id: { in: [first.syncLogId ?? "", second.syncLogId ?? ""] } } }), 2)
    })
  })

  it("replaces the participant set when the provider changes a side, without changing the match id", async () => {
    await withRollback(async (tx) => {
      const repository = createSyncRepository(tx)
      await runSync(repository, TENNIS_SOURCE, { now: NOW, resolveProvider: tennisWith(fixtureSet).resolve })
      const before = await tx.match.findUniqueOrThrow({ where: { dataSourceId_externalId: { dataSourceId: TENNIS_SOURCE, externalId: "sr:sport_event:50001" } } })
      const swapped = { ...singlesClosed, sport_event: { ...singlesClosed.sport_event, competitors: singlesClosed.sport_event.competitors?.map((c) => ({ ...c, qualifier: c.qualifier === "home" ? "away" : "home" })) } }
      const result = await runSync(repository, TENNIS_SOURCE, { now: NOW, resolveProvider: tennisWith({ "sr:season:130001": [swapped] }).resolve })
      assert.equal(result.status, "SUCCESS")
      const after_ = await tx.match.findUniqueOrThrow({ where: { id: before.id }, include: { participants: { include: { player: true }, orderBy: [{ side: "asc" }, { order: "asc" }] } } })
      assert.deepEqual(after_.participants.map((p) => `${p.side}:${p.player?.externalId}`), ["A:sr:competitor:407573", "B:sr:competitor:14882"])
      assert.equal(await tx.matchParticipant.count({ where: { matchId: before.id } }), 2)
    })
  })

  it("partial failure: one malformed record becomes an issue, the rest persist, the run is PARTIAL", async () => {
    await withRollback(async (tx) => {
      const result = await runSync(createSyncRepository(tx), TENNIS_SOURCE, { now: NOW, resolveProvider: tennisWith({ "sr:season:130001": [singlesClosed], "sr:season:130002": [doublesLive, broken] }).resolve })
      assert.equal(result.status, "PARTIAL")
      assert.equal(result.counts.matches.created, 2)
      assert.equal(result.counts.matches.failed, 1)
      assert.ok(result.issues.some((i) => i.level === "error" && i.externalId === "sr:sport_event:50004"))
      assert.equal(await tx.match.count({ where: { dataSourceId: TENNIS_SOURCE } }), 2)
      const log = await tx.syncLog.findUniqueOrThrow({ where: { id: result.syncLogId ?? "" } })
      assert.equal(log.status, "PARTIAL")
      assert.match(log.error ?? "", /sr:sport_event:50004/)
      assert.doesNotMatch(log.error ?? "", /test-key/)
    })
  })

  it("configuration failure: no request, FAILED log with a classified message and no credential", async () => {
    await withRollback(async (tx) => {
      const api = fakeApi(fixtureSet)
      const provider = createSportradarTennisProvider({ config: configured({ apiKey: undefined }), request: api.request }) as Provider<never>
      const result = await runSync(createSyncRepository(tx), TENNIS_SOURCE, { now: NOW, resolveProvider: () => provider })
      assert.equal(result.status, "FAILED")
      assert.equal(result.errorKind, "configuration")
      assert.match(result.error ?? "", /SPORTRADAR_API_KEY is not set/)
      assert.equal(api.calls.length, 0)
      const log = await tx.syncLog.findUniqueOrThrow({ where: { id: result.syncLogId ?? "" } })
      assert.equal(log.status, "FAILED")
      assert.match(log.error ?? "", /^Configuration error/)
      assert.equal(await tx.match.count({ where: { dataSourceId: TENNIS_SOURCE } }), 0)
      const source = await tx.dataSource.findUniqueOrThrow({ where: { id: TENNIS_SOURCE } })
      assert.notEqual(source.lastSyncedAt?.toISOString(), NOW.toISOString(), "lastSyncedAt is not touched by a failed run")
    })
  })

  it("transient failure: an exhausted 429 is reported as rate limiting, 503 as a server error, 401 as configuration", async () => {
    await withRollback(async (tx) => {
      const cases: [number, string, RegExp][] = [
        [429, "rate-limit", /Rate limited/],
        [503, "server", /server error/],
        [401, "configuration", /rejected the API key/],
      ]
      for (const [status, kind, pattern] of cases) {
        const provider = createSportradarTennisProvider({ config: configured(), request: async (url) => { throw new HttpError(status, url) } }) as Provider<never>
        const result = await runSync(createSyncRepository(tx), TENNIS_SOURCE, { now: NOW, resolveProvider: () => provider })
        assert.equal(result.status, "FAILED")
        assert.equal(result.errorKind, kind, `HTTP ${status}`)
        assert.match(result.error ?? "", pattern)
        assert.doesNotMatch(result.error ?? "", /test-key/)
      }
    })
  })

  it("mock basketball still syncs through the same pipeline (PARTIAL because of its unknown-team fixture)", async () => {
    await withRollback(async (tx) => {
      const result = await runSync(createSyncRepository(tx), BASKETBALL_SOURCE, { now: NOW, resolveProvider: () => mockBasketballProvider as Provider<never> })
      assert.equal(result.provider, "mock-basketball")
      assert.equal(result.status, "PARTIAL")
      assert.equal(result.counts.matches.failed, 1)
      const match = await tx.match.findUniqueOrThrow({ where: { dataSourceId_externalId: { dataSourceId: BASKETBALL_SOURCE, externalId: "5001" } }, include: { participants: { include: { team: true }, orderBy: { side: "asc" } } } })
      assert.deepEqual(match.participants.map((p) => [p.side, p.team?.externalId, p.playerId]), [["A", "3001", null], ["B", "3002", null]])
      assert.equal(match.status, "FINISHED")
      assert.equal(match.sideAScore, 98)
      assert.equal(match.sideBScore, 91)
    })
  })
})
