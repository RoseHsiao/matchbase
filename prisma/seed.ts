/**
 * Seeds PostgreSQL from the existing mock dataset in lib/data/mock.ts.
 *
 * Source of truth: the mock arrays and the sport registry in lib/sports.ts.
 * Nothing here invents records; every row maps to an existing mock record and
 * keeps its id, so routes such as /matches/[id] and /teams/[id] keep working
 * against the database.
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
 * Determinism: mock.ts generates every timestamp relative to the moment the
 * module is imported. The seed instead anchors all timestamps to a fixed
 * reference instant (SEED_NOW, Asia/Taipei) so re-running never moves dates.
 * Match times are transcribed as generator specs below and self-checked
 * against the live mock values on every run, so the two cannot drift apart.
 *
 * Idempotent: every row is upserted by id. No table is truncated.
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
import { DEMO_USER_EMAIL, DEMO_USER_ID, DEMO_USER_NAME } from "../lib/data/demo-user"
import { validateParticipants } from "../lib/data/match-participants"
import { toDbReminder } from "../lib/data/repositories/watchlist-reminder-ops"
import type * as MockTypes from "../lib/data/types"
import { sportMeta, sports } from "../lib/sports"

// ---------------------------------------------------------------------------
// Fixed reference time
// ---------------------------------------------------------------------------

/** Presentation timezone (decisions §12). Asia/Taipei has no DST. */
const TZ_OFFSET_HOURS = 8

/** Seed "now": 2026-09-14 12:00 Asia/Taipei. Every relative time is anchored here. */
const SEED_DAY = { year: 2026, month: 8 /* September, zero-based */, day: 14 }
const SEED_NOW = Date.UTC(SEED_DAY.year, SEED_DAY.month, SEED_DAY.day, 12 - TZ_OFFSET_HOURS, 0, 0)

/** Mirrors mock `fromNow(minutes)`, anchored to SEED_NOW. */
function seedFromNow(minutes: number): Date {
  return new Date(SEED_NOW + minutes * 60_000)
}

/** Mirrors mock `at(dayOffset, hour, minute)`, evaluated in Asia/Taipei. */
function seedAt(dayOffset: number, hour: number, minute = 0): Date {
  return new Date(
    Date.UTC(SEED_DAY.year, SEED_DAY.month, SEED_DAY.day + dayOffset, hour - TZ_OFFSET_HOURS, minute, 0, 0)
  )
}

/**
 * Re-anchor a mock `fromNow()` value: recover the minute offset from the
 * import-time clock and apply it to SEED_NOW. Every mock offset is a whole
 * number of minutes, so rounding removes import jitter.
 */
function reanchor(iso: string, importNow: number): Date {
  const offsetMs = Date.parse(iso) - importNow
  const minutes = Math.round(offsetMs / 60_000)
  if (Math.abs(offsetMs - minutes * 60_000) > 5_000) {
    throw new Error(`Timestamp ${iso} is not a whole-minute offset from now; cannot re-anchor deterministically.`)
  }
  return seedFromNow(minutes)
}

// ---------------------------------------------------------------------------
// Match time specs, transcribed from lib/data/mock.ts
// ---------------------------------------------------------------------------

type TimeSpec =
  | { kind: "fromNow"; minutes: number }
  | { kind: "at"; dayOffset: number; hour: number; minute: number }

const fromNow = (minutes: number): TimeSpec => ({ kind: "fromNow", minutes })
const at = (dayOffset: number, hour: number, minute = 0): TimeSpec => ({ kind: "at", dayOffset, hour, minute })

/** One entry per mock match. Verified against the live mock values in `checkTimeSpecs`. */
const MATCH_TIME_SPECS: Record<string, TimeSpec> = {
  "m-lec-g2-fnc": fromNow(-240),
  "m-esl-navi-faze": fromNow(-180),
  "m-epl-ars-che": fromNow(-67),
  "m-vct-sen-prx": fromNow(-45),
  "m-epl-liv-mci": fromNow(150),
  "m-esl-vit-spi": fromNow(210),
  "m-nba-lal-bos": fromNow(330),
  "m-ucl-rma-fcb": at(1, 21, 0),
  "m-lec-kc-mad": at(1, 18, 0),
  "m-nba-gsw-den": at(1, 19, 30),
  "m-vct-fut-loud": at(2, 17, 0),
  "m-epl-tot-ars": at(3, 16, 30),
  "m-esl-faze-vit": at(4, 20, 0),
  "m-lec-g2-kc": at(6, 17, 0),
  "m-lck-t1-geng": fromNow(90),
  "m-lck-hle-dk": at(1, 17, 0),
  "m-lck-geng-dk": at(3, 17, 0),
  "m-lck-t1-hle": at(-1, 17, 0),
  "m-epl-mci-tot": at(-2, 20, 0),
  "m-nba-bos-gsw": at(-1, 19, 30),
  "m-wim-alcaraz-sinner": at(-1, 14, 0),
  "m-wim-sinner-alcaraz-exh": at(3, 15, 0),
  "m-wim-doubles-final": at(2, 13, 0),
}

/** Evaluate a spec the way mock.ts does (machine-local time), for the self-check. */
function evaluateLikeMock(spec: TimeSpec, importNow: number): Date {
  if (spec.kind === "fromNow") return new Date(importNow + spec.minutes * 60_000)
  const date = new Date(importNow)
  date.setDate(date.getDate() + spec.dayOffset)
  date.setHours(spec.hour, spec.minute, 0, 0)
  return date
}

/** Evaluate a spec against the fixed seed reference. */
function evaluateForSeed(spec: TimeSpec): Date {
  return spec.kind === "fromNow" ? seedFromNow(spec.minutes) : seedAt(spec.dayOffset, spec.hour, spec.minute)
}

/** Throws if the transcribed specs and the mock values disagree. */
function checkTimeSpecs(matches: readonly MockTypes.Match[], importNow: number): void {
  const specIds = new Set(Object.keys(MATCH_TIME_SPECS))
  for (const match of matches) {
    const spec = MATCH_TIME_SPECS[match.id]
    if (!spec) throw new Error(`No time spec for mock match ${match.id}.`)
    specIds.delete(match.id)
    const expected = evaluateLikeMock(spec, importNow).getTime()
    const actual = Date.parse(match.startsAt)
    const tolerance = spec.kind === "fromNow" ? 5_000 : 0
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`Time spec for ${match.id} does not reproduce the mock value (drift ${actual - expected} ms).`)
    }
  }
  if (specIds.size > 0) throw new Error(`Time specs without a mock match: ${[...specIds].join(", ")}.`)
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
  const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
  if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL must be set.")

  // Capture the clock right before the mock module evaluates its relative
  // timestamps, so its offsets can be recovered.
  const importNow = Date.now()
  const mock = await import("../lib/data/mock")

  checkTimeSpecs(mock.matches, importNow)

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
      lastSyncedAt: source.lastSyncedAt ? reanchor(source.lastSyncedAt, importNow) : null,
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
      startsAt: evaluateForSeed(MATCH_TIME_SPECS[match.id]),
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
      startedAt: reanchor(log.at, importNow),
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
    console.log(`Seeded from mock data (reference time ${new Date(SEED_NOW).toISOString()}):`)
    for (const [table, count] of Object.entries(counts)) console.log(`  ${table}: ${count}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
