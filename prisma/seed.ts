/**
 * Seeds PostgreSQL from the demo dataset in lib/data/mock.ts.
 *
 * Source of truth: the mock arrays, the demo timeline, and the sport registry
 * in lib/sports.ts. Nothing here invents records; every row maps to an
 * existing mock record and keeps its id, so routes such as /matches/[id] and
 * /teams/[id] keep working against the database.
 *
 * Normalisation applied (see docs/data-model-decisions.md):
 * - Sport rows come from the code registry (`sports` + `sportMeta`).
 * - League.season (a label) is resolved to the Season row of that league with
 *   the same name; Match.seasonId points at it.
 * - Match.venue (free text) is resolved to Venue.id by exact name.
 * - Lowercase mock statuses map to the Prisma enums. DataSource
 *   connected/attention -> ACTIVE, disconnected -> INACTIVE.
 * - SyncLog.at -> SyncLog.startedAt.
 * - Match.participants -> MatchParticipant rows, reconciled by (matchId, side, order).
 *
 * Time: the demo timeline is written as offsets from an anchor. This seed
 * lays it over the real date (or DEMO_ANCHOR for a reproducible run), in
 * Asia/Taipei for day boundaries, so the dashboard, schedule, watchlist and
 * history stay populated as the calendar moves. Statuses are authored in the
 * timeline, never derived from the clock; lib/data/demo-consistency.ts
 * refuses any anchor for which status, start time, scores and reminders
 * would contradict each other. See docs/demo-data-and-time.md.
 *
 * Idempotent: every row is upserted by a fixed id (never derived from time).
 * Re-seeding on another day moves the demo timestamps and nothing else.
 * Rows owned by external providers (dataSourceId + externalId) are never
 * touched. No table is truncated.
 *
 * User state: the single development user (lib/data/demo-user.ts) is created
 * and the mock `currentUserFollows` ids become its follow / watchlist rows,
 * so the dashboard and watchlist show the same demo state as before. Rows the
 * user adds at runtime are kept; the seed only guarantees the demo rows exist.
 * Watchlist reminders on the demo rows are reset to the mock values, so the
 * demo state (one match per reminder option) is reproducible.
 *
 * Not seeded: AdminActivity (no table in v1).
 */

import { PrismaPg } from "@prisma/adapter-pg"

import {
  DataSourceStatus,
  EntityStatus,
  MatchStatus,
  PrismaClient,
  SeasonStatus,
  SyncStatus,
  type Prisma,
} from "../lib/generated/prisma/client"
import { checkDemoConsistency } from "../lib/data/demo-consistency"
import { DEMO_USER_EMAIL, DEMO_USER_ID, DEMO_USER_NAME } from "../lib/data/demo-user"
import { validateParticipants } from "../lib/data/match-participants"
import * as catalogue from "../lib/data/mock"
import { buildDemoData } from "../lib/data/mock"
import { createDemoClock, DEMO_TIME_ZONE, resolveDemoAnchor } from "../lib/demo-clock"
import { seedPolicy } from "../lib/env/runtime-environment"
import { toDbReminder } from "../lib/data/repositories/watchlist-reminder-ops"
import type * as MockTypes from "../lib/data/types"
import { sportMeta, sports } from "../lib/sports"

// ---------------------------------------------------------------------------
// Demo clock
// ---------------------------------------------------------------------------

/**
 * The anchor for this run: the real date floored to the half hour, or
 * DEMO_ANCHOR when set (see lib/demo-clock.ts for the accepted forms).
 * Day-relative offsets are evaluated in DEMO_TIME_ZONE (Asia/Taipei).
 */
function demoClockFromEnv() {
  return createDemoClock({ anchor: resolveDemoAnchor(process.env, new Date()), timeZone: DEMO_TIME_ZONE })
}

// ---------------------------------------------------------------------------
// Status mappings
// ---------------------------------------------------------------------------

function entityStatus(value: MockTypes.EntityStatus | undefined): EntityStatus {
  return value === "inactive" ? EntityStatus.INACTIVE : EntityStatus.ACTIVE
}

const seasonStatus: Record<MockTypes.SeasonStatus, SeasonStatus> = {
  current: SeasonStatus.CURRENT,
  upcoming: SeasonStatus.UPCOMING,
  completed: SeasonStatus.COMPLETED,
}

const matchStatus: Record<MockTypes.MatchStatus, MatchStatus> = {
  upcoming: MatchStatus.UPCOMING,
  live: MatchStatus.LIVE,
  finished: MatchStatus.FINISHED,
}

/** "attention" is a health signal derived from SyncLog in v1, so the feed stays ACTIVE. */
const dataSourceStatus: Record<MockTypes.DataSourceStatus, DataSourceStatus> = {
  connected: DataSourceStatus.ACTIVE,
  attention: DataSourceStatus.ACTIVE,
  disconnected: DataSourceStatus.INACTIVE,
}

const syncStatus: Record<MockTypes.SyncStatus, SyncStatus> = {
  running: SyncStatus.RUNNING,
  success: SyncStatus.SUCCESS,
  partial: SyncStatus.PARTIAL,
  failed: SyncStatus.FAILED,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Cannot map mock data: ${label}.`)
  return value
}

/** "YYYY-MM-DD" -> Date at UTC midnight, which Prisma stores in a `date` column. */
function isoDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Expected YYYY-MM-DD, got ${value}.`)
  return new Date(`${value}T00:00:00.000Z`)
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function main() {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file)
    } catch {
      // optional
    }
  }
  // Production guard before anything touches a connection: the demo seed is a development fixture.
  const policy = seedPolicy(process.env)
  if (!policy.allowed) {
    console.error(`Seed refused: ${policy.reason}`)
    process.exit(3)
  }
  if (policy.note) console.warn(policy.note)

  const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
  if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL must be set.")

  const clock = demoClockFromEnv()
  const timeline = buildDemoData(clock)
  const mock = { ...catalogue, ...timeline }

  const issues = checkDemoConsistency({ matches: mock.matches, follows: mock.currentUserFollows }, clock)
  if (issues.length > 0) throw new Error(`Demo timeline is not coherent for anchor ${clock.anchor.toISOString()}:\n  ${issues.join("\n  ")}`)

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

  /**
   * Each table is written in one transaction of sequential upserts. Over a
   * remote connection a batch of ~25 round trips can exceed Prisma's default
   * 5 s transaction limit, so allow a generous timeout.
   */
  const transaction = <T,>(operations: Prisma.PrismaPromise<T>[]) =>
    prisma.$transaction(operations, { timeout: 60_000 })

  try {
    // 1. Sport: from the code registry, in registry order.
    const sportRows: Prisma.SportCreateInput[] = sports.map((id, index) => ({
      id,
      category: sportMeta[id].category === "esports" ? "ESPORTS" : "SPORTS",
      name: sportMeta[id].label,
      homeAway: sportMeta[id].homeAway,
      status: EntityStatus.ACTIVE,
      sortOrder: index,
    }))
    await transaction(
      sportRows.map((data) => prisma.sport.upsert({ where: { id: data.id }, create: data, update: data }))
    )

    // 2. DataSource
    const dataSourceRows: Prisma.DataSourceUncheckedCreateInput[] = mock.dataSources.map((source) => ({
      id: source.id,
      name: source.name,
      sportId: source.sport ?? null,
      status: dataSourceStatus[source.status],
      lastSyncedAt: source.lastSyncedAt ? new Date(source.lastSyncedAt) : null,
    }))
    await transaction(
      dataSourceRows.map((data) => prisma.dataSource.upsert({ where: { id: data.id }, create: data, update: data }))
    )

    // 3. League (no season label; see Season)
    const leagueRows: Prisma.LeagueUncheckedCreateInput[] = mock.leagues.map((league) => ({
      id: league.id,
      sportId: league.sport,
      name: league.name,
      shortName: league.shortName,
      region: league.region,
      status: entityStatus(league.status),
    }))
    await transaction(
      leagueRows.map((data) => prisma.league.upsert({ where: { id: data.id }, create: data, update: data }))
    )

    // 4. Season
    const seasonRows: Prisma.SeasonUncheckedCreateInput[] = mock.seasons.map((season) => ({
      id: season.id,
      leagueId: season.leagueId,
      name: season.name,
      startsAt: isoDate(season.startsAt),
      endsAt: isoDate(season.endsAt),
      status: seasonStatus[season.status],
    }))
    await transaction(
      seasonRows.map((data) => prisma.season.upsert({ where: { id: data.id }, create: data, update: data }))
    )

    // League.season label -> Season row of that league with the same name.
    const seasonIdByLeague = new Map<string, string>()
    for (const league of mock.leagues) {
      const season = mock.seasons.find((entry) => entry.leagueId === league.id && entry.name === league.season)
      seasonIdByLeague.set(
        league.id,
        must(season, `league ${league.id} has season label "${league.season}" but no Season row with that name`).id
      )
    }

    // 5. Team
    const teamRows: Prisma.TeamUncheckedCreateInput[] = mock.teams.map((team) => ({
      id: team.id,
      leagueId: team.leagueId,
      name: team.name,
      shortName: team.shortName,
      code: team.code,
      color: team.color,
      logoUrl: team.logoUrl ?? null,
      status: entityStatus(team.status),
    }))
    await transaction(
      teamRows.map((data) => prisma.team.upsert({ where: { id: data.id }, create: data, update: data }))
    )

    // 6. Player
    const teamIds = new Set(mock.teams.map((team) => team.id))
    const playerRows: Prisma.PlayerUncheckedCreateInput[] = mock.players.map((player) => {
      // Individual-sport athletes have no team (decisions §4); a team, when given, must exist.
      if (player.teamId !== undefined && !teamIds.has(player.teamId)) throw new Error(`Cannot map mock data: player ${player.id} references unknown team ${player.teamId}.`)
      return {
        id: player.id,
        teamId: player.teamId ?? null,
        name: player.name,
        handle: player.handle ?? null,
        role: player.role,
        nationality: player.nationality ?? null,
        number: player.number ?? null,
        status: entityStatus(player.status),
      }
    })
    await transaction(
      playerRows.map((data) => prisma.player.upsert({ where: { id: data.id }, create: data, update: data }))
    )

    // 7. Venue
    const venueRows: Prisma.VenueUncheckedCreateInput[] = mock.venues.map((venue) => ({
      id: venue.id,
      name: venue.name,
      city: venue.city,
      country: venue.country,
      capacity: venue.capacity ?? null,
      status: entityStatus(venue.status),
    }))
    await transaction(
      venueRows.map((data) => prisma.venue.upsert({ where: { id: data.id }, create: data, update: data }))
    )
    const venueIdByName = new Map(mock.venues.map((venue) => [venue.name, venue.id]))

    // 8. Match
    const matchRows: Prisma.MatchUncheckedCreateInput[] = mock.matches.map((match) => ({
      id: match.id,
      leagueId: match.leagueId,
      seasonId: must(seasonIdByLeague.get(match.leagueId), `match ${match.id} league ${match.leagueId} has no season`),
      venueId: match.venue === undefined ? null : must(venueIdByName.get(match.venue), `match ${match.id} venue "${match.venue}" has no Venue row`),
      startsAt: new Date(match.startsAt),
      status: matchStatus[match.status],
      stage: match.stage ?? null,
      sideAScore: match.score?.a ?? null,
      sideBScore: match.score?.b ?? null,
      liveDetail: match.liveDetail ?? null,
    }))
    await transaction(
      matchRows.map((data) => prisma.match.upsert({ where: { id: data.id }, create: data, update: data }))
    )

    // 9. MatchParticipant. Reconciled by the natural key (matchId, side, order) rather than
    //    by id, so rows created by the participant backfill migration keep their ids. Every
    //    participant of a seeded match must be one of the mock participants; the rest go.
    const playerIds = new Set(mock.players.map((player) => player.id))
    const participantRows = mock.matches.flatMap((match) => {
      const validation = validateParticipants(match.participants)
      if (!validation.ok) throw new Error(`Cannot map mock data: match ${match.id}: ${validation.error}`)
      return validation.participants.map((participant) => {
        if (participant.teamId !== undefined && !teamIds.has(participant.teamId)) throw new Error(`Cannot map mock data: match ${match.id} references unknown team ${participant.teamId}.`)
        if (participant.playerId !== undefined && !playerIds.has(participant.playerId)) throw new Error(`Cannot map mock data: match ${match.id} references unknown player ${participant.playerId}.`)
        return { matchId: match.id, side: participant.side, order: participant.order, teamId: participant.teamId ?? null, playerId: participant.playerId ?? null }
      })
    })
    const kept = await transaction(
      participantRows.map((data) =>
        prisma.matchParticipant.upsert({
          where: { matchId_side_order: { matchId: data.matchId, side: data.side, order: data.order } },
          create: data,
          update: { teamId: data.teamId, playerId: data.playerId },
          select: { id: true },
        })
      )
    )
    await prisma.matchParticipant.deleteMany({
      where: { matchId: { in: mock.matches.map((match) => match.id) }, id: { notIn: kept.map((row) => row.id) } },
    })

    // 10. SyncLog (mock `at` -> startedAt)
    const syncLogRows: Prisma.SyncLogUncheckedCreateInput[] = mock.syncLogs.map((log) => ({
      id: log.id,
      dataSourceId: log.dataSourceId,
      entity: log.entity,
      records: log.records,
      status: syncStatus[log.status],
      durationMs: log.durationMs,
      startedAt: new Date(log.at),
      error: null,
    }))
    await transaction(
      syncLogRows.map((data) => prisma.syncLog.upsert({ where: { id: data.id }, create: data, update: data }))
    )

    // 11. Development user and the demo follows / watchlist from mock data.
    const userId = DEMO_USER_ID
    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, email: DEMO_USER_EMAIL, name: DEMO_USER_NAME },
      update: { email: DEMO_USER_EMAIL, name: DEMO_USER_NAME },
    })
    const follows = mock.currentUserFollows
    await transaction<unknown>([
      ...follows.teamIds.map((teamId) =>
        prisma.userTeamFollow.upsert({ where: { userId_teamId: { userId, teamId } }, create: { userId, teamId }, update: {} })
      ),
      ...follows.playerIds.map((playerId) =>
        prisma.userPlayerFollow.upsert({ where: { userId_playerId: { userId, playerId } }, create: { userId, playerId }, update: {} })
      ),
      ...follows.leagueIds.map((leagueId) =>
        prisma.userLeagueFollow.upsert({ where: { userId_leagueId: { userId, leagueId } }, create: { userId, leagueId }, update: {} })
      ),
      ...follows.watchlistMatchIds.map((matchId) => {
        const reminder = toDbReminder[follows.watchlistReminders[matchId] ?? "off"]
        return prisma.userWatchlistMatch.upsert({ where: { userId_matchId: { userId, matchId } }, create: { userId, matchId, reminder }, update: { reminder } })
      }),
    ])

    const counts = {
      sport: await prisma.sport.count(),
      league: await prisma.league.count(),
      season: await prisma.season.count(),
      team: await prisma.team.count(),
      player: await prisma.player.count(),
      venue: await prisma.venue.count(),
      match: await prisma.match.count(),
      matchParticipant: await prisma.matchParticipant.count(),
      dataSource: await prisma.dataSource.count(),
      syncLog: await prisma.syncLog.count(),
      user: await prisma.user.count(),
      userTeamFollow: await prisma.userTeamFollow.count(),
      userPlayerFollow: await prisma.userPlayerFollow.count(),
      userLeagueFollow: await prisma.userLeagueFollow.count(),
      userWatchlistMatch: await prisma.userWatchlistMatch.count(),
    }
    const anchorLocal = clock.anchorDate()
    console.log(`Seeded demo data. Anchor ${clock.anchor.toISOString()} (${anchorLocal.year}-${String(anchorLocal.month).padStart(2, "0")}-${String(anchorLocal.day).padStart(2, "0")} in ${clock.timeZone}${process.env.DEMO_ANCHOR ? ", from DEMO_ANCHOR" : ", from the current date"}):`)
    for (const [table, count] of Object.entries(counts)) console.log(`  ${table}: ${count}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
