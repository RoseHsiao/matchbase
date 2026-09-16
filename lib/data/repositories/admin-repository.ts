import "server-only"

import { db } from "@/lib/data/db"
import { validateParticipants } from "@/lib/data/match-participants"
import { describeDataSourceProvider } from "@/lib/data/sync/providers/registry"
import { adminActivity } from "@/lib/data/mock"
import {
  entityStatus,
  leagueInclude,
  matchInclude,
  toLeague,
  toMatch,
  toPlayer,
  toSeason,
  toSport,
  toTeam,
} from "@/lib/data/repositories/mappers"
import type {
  AdminData,
  DataSource,
  DataSourceStatus,
  EntityStatus,
  MatchStatus,
  SeasonStatus,
  SportRecord,
  SyncEntity,
  SyncLog,
  SyncStatus,
  Venue,
} from "@/lib/data/types"
import { Prisma } from "@/lib/generated/prisma/client"
import type {
  DataSourceStatus as DbDataSourceStatus,
  EntityStatus as DbEntityStatus,
  MatchStatus as DbMatchStatus,
  SeasonStatus as DbSeasonStatus,
  SyncStatus as DbSyncStatus,
} from "@/lib/generated/prisma/enums"
import { sportMeta } from "@/lib/sports"

/**
 * Admin persistence. Reads produce the same domain shapes the Admin UI already
 * consumes (lib/data/types.ts); writes validate the untrusted form payload,
 * then upsert by id so create and update share one path and the client store's
 * optimistic id is the row id. Every failure is an `AdminError` with a message
 * safe to show; Prisma errors never reach the UI.
 *
 * Boundary with the sport registry: Sport rows persist `status` (and carry
 * category / name / homeAway / sortOrder), but the UI still reads labels,
 * category and Home/Away wording from lib/sports.ts (decisions §2). Admin can
 * change only status, exactly as before.
 */

export class AdminError extends Error {}

// ---------------------------------------------------------------------------
// Domain -> database enum maps
// ---------------------------------------------------------------------------

const toDbEntityStatus: Record<EntityStatus, DbEntityStatus> = { active: "ACTIVE", inactive: "INACTIVE" }
const toDbSeasonStatus: Record<SeasonStatus, DbSeasonStatus> = { current: "CURRENT", upcoming: "UPCOMING", completed: "COMPLETED" }
const toDbMatchStatus: Record<MatchStatus, DbMatchStatus> = { upcoming: "UPCOMING", live: "LIVE", finished: "FINISHED" }
/** "attention" is derived from sync logs, never stored (decisions notes). */
const toDbDataSourceStatus: Record<DataSourceStatus, DbDataSourceStatus> = { connected: "ACTIVE", attention: "ACTIVE", disconnected: "INACTIVE" }
const fromDbSyncStatus: Record<DbSyncStatus, SyncStatus> = { RUNNING: "running", SUCCESS: "success", PARTIAL: "partial", FAILED: "failed" }

// ---------------------------------------------------------------------------
// Payload validation (form input is untrusted)
// ---------------------------------------------------------------------------

type Payload = Record<string, unknown>

function payload(input: unknown): Payload {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new AdminError("Invalid record.")
  return input as Payload
}

function text(p: Payload, key: string, label: string, options: { required?: boolean; max?: number } = {}): string | undefined {
  const value = p[key]
  if (value === undefined || value === null || value === "") {
    if (options.required) throw new AdminError(`${label} is required.`)
    return undefined
  }
  if (typeof value !== "string") throw new AdminError(`${label} must be text.`)
  const trimmed = value.trim()
  if (options.required && trimmed.length === 0) throw new AdminError(`${label} is required.`)
  if (trimmed.length > (options.max ?? 200)) throw new AdminError(`${label} is too long.`)
  return trimmed
}

function requiredText(p: Payload, key: string, label: string, max?: number): string {
  return text(p, key, label, { required: true, max }) as string
}

function id(p: Payload, key = "id"): string {
  const value = requiredText(p, key, "Id")
  if (!/^[A-Za-z0-9_.-]{1,200}$/.test(value)) throw new AdminError("Invalid id.")
  return value
}

function oneOf<T extends string>(p: Payload, key: string, label: string, allowed: readonly T[], fallback?: T): T {
  const value = p[key]
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) return fallback
    throw new AdminError(`${label} is required.`)
  }
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new AdminError(`${label} is invalid.`)
  return value as T
}

function optionalInt(p: Payload, key: string, label: string, min = 0): number | undefined {
  const value = p[key]
  if (value === undefined || value === null || value === "") return undefined
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) throw new AdminError(`${label} must be a whole number of at least ${min}.`)
  return value
}

function isoDate(p: Payload, key: string, label: string): Date {
  const value = requiredText(p, key, label)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AdminError(`${label} must be a date (YYYY-MM-DD).`)
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) throw new AdminError(`${label} is not a valid date.`)
  return date
}

function instant(p: Payload, key: string, label: string): Date {
  const value = requiredText(p, key, label)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new AdminError(`${label} is not a valid date and time.`)
  return date
}

function sportId(p: Payload, key: string, options: { required: boolean }): string | undefined {
  const value = text(p, key, "Sport / game", { required: options.required })
  if (value !== undefined && !(value in sportMeta)) throw new AdminError("Unknown sport or game.")
  return value
}

const ENTITY_STATUSES = ["active", "inactive"] as const
const SEASON_STATUSES = ["current", "upcoming", "completed"] as const
const MATCH_STATUSES = ["upcoming", "live", "finished"] as const
const DATA_SOURCE_STATUSES = ["connected", "disconnected", "attention"] as const

// ---------------------------------------------------------------------------
// Prisma error translation
// ---------------------------------------------------------------------------

function isKnown(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
}

/** Runs a write and turns constraint failures into AdminErrors. */
async function write<T>(action: () => Promise<T>, messages: { unique?: string; reference?: string; missing?: string } = {}): Promise<T> {
  try {
    return await action()
  } catch (error) {
    if (isKnown(error, "P2002")) throw new AdminError(messages.unique ?? "A record with the same unique value already exists.")
    if (isKnown(error, "P2003")) throw new AdminError(messages.reference ?? "A referenced record does not exist or is still in use.")
    if (isKnown(error, "P2025")) throw new AdminError(messages.missing ?? "The record no longer exists.")
    throw error
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function toVenue(row: { id: string; name: string; city: string | null; country: string | null; capacity: number | null; status: DbEntityStatus }): Venue {
  return { id: row.id, name: row.name, city: row.city ?? "", country: row.country ?? "", capacity: row.capacity ?? undefined, status: entityStatus[row.status] }
}

function toSyncLog(row: { id: string; dataSourceId: string; entity: string; records: number; status: DbSyncStatus; durationMs: number | null; startedAt: Date; error: string | null }): SyncLog {
  return {
    id: row.id,
    dataSourceId: row.dataSourceId,
    entity: row.entity as SyncEntity,
    records: row.records,
    status: fromDbSyncStatus[row.status],
    durationMs: row.durationMs ?? 0,
    at: row.startedAt.toISOString(),
    error: row.error ?? undefined,
  }
}

/** Feed health: stored INACTIVE is "disconnected"; ACTIVE is "attention" when the latest run did not succeed. */
function deriveDataSourceStatus(status: DbDataSourceStatus, latest: DbSyncStatus | undefined): DataSourceStatus {
  if (status === "INACTIVE") return "disconnected"
  if (latest === "FAILED" || latest === "PARTIAL") return "attention"
  return "connected"
}

export const adminRepository = {
  /** Everything the admin area manages, batched: one query per collection. */
  async getAll(): Promise<AdminData> {
    const [sports, leagues, seasons, teams, players, venues, matches, dataSources, syncLogs] = await Promise.all([
      db.sport.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
      db.league.findMany({ include: leagueInclude, orderBy: [{ sport: { sortOrder: "asc" } }, { name: "asc" }] }),
      db.season.findMany({ orderBy: [{ leagueId: "asc" }, { startsAt: "desc" }] }),
      db.team.findMany({ orderBy: { name: "asc" } }),
      db.player.findMany({ orderBy: { name: "asc" } }),
      db.venue.findMany({ orderBy: { name: "asc" } }),
      db.match.findMany({ include: matchInclude, orderBy: [{ startsAt: "asc" }, { id: "asc" }] }),
      db.dataSource.findMany({
        include: { syncLogs: { select: { status: true }, orderBy: { startedAt: "desc" }, take: 1 } },
        orderBy: { name: "asc" },
      }),
      db.syncLog.findMany({ orderBy: { startedAt: "desc" } }),
    ])
    return {
      sports: sports.map((row): SportRecord => ({ id: toSport(row.id), status: entityStatus[row.status] })),
      leagues: leagues.map(toLeague),
      seasons: seasons.map(toSeason),
      teams: teams.map(toTeam),
      players: players.map(toPlayer),
      matches: matches.map(toMatch),
      venues: venues.map(toVenue),
      dataSources: dataSources.map((row): DataSource => {
        const binding = describeDataSourceProvider(row.id)
        return {
          id: row.id,
          name: row.name,
          sport: row.sportId === null ? undefined : toSport(row.sportId),
          status: deriveDataSourceStatus(row.status, row.syncLogs[0]?.status),
          lastSyncedAt: row.lastSyncedAt?.toISOString(),
          provider: binding
            ? {
                key: binding.key,
                name: binding.name,
                kind: binding.kind,
                configured: binding.configuration.configured,
                configurationError: binding.configuration.configured ? undefined : binding.configuration.error,
              }
            : undefined,
        }
      }),
      syncLogs: syncLogs.map(toSyncLog),
      // Audit logging is deferred (decisions §16); the landing page keeps its demo feed.
      activity: [...adminActivity],
    }
  },

  // -------------------------------------------------------------------------
  // Writes: upsert by id
  // -------------------------------------------------------------------------

  /** The catalogue of sports is code; only the status is editable. */
  async saveSport(input: unknown): Promise<void> {
    const p = payload(input)
    const sport = id(p)
    if (!(sport in sportMeta)) throw new AdminError("Unknown sport or game.")
    const status = toDbEntityStatus[oneOf(p, "status", "Status", ENTITY_STATUSES, "active")]
    await write(() => db.sport.update({ where: { id: sport }, data: { status } }), { missing: "This sport is not in the database yet; run the seed." })
  },

  async saveLeague(input: unknown): Promise<void> {
    const p = payload(input)
    const data = {
      sportId: sportId(p, "sport", { required: true }) as string,
      name: requiredText(p, "name", "Name"),
      shortName: requiredText(p, "shortName", "Short name", 40),
      region: text(p, "region", "Region") ?? null,
      status: toDbEntityStatus[oneOf(p, "status", "Status", ENTITY_STATUSES, "active")],
    }
    await write(() => db.league.upsert({ where: { id: id(p) }, create: { id: id(p), ...data }, update: data }), {
      unique: "A league with this short name already exists for that sport or game.",
      reference: "The selected sport or game does not exist.",
    })
  },

  async saveSeason(input: unknown): Promise<void> {
    const p = payload(input)
    const seasonId = id(p)
    const data = {
      leagueId: id(p, "leagueId"),
      name: requiredText(p, "name", "Name", 80),
      startsAt: isoDate(p, "startsAt", "Start date"),
      endsAt: isoDate(p, "endsAt", "End date"),
      status: toDbSeasonStatus[oneOf(p, "status", "Status", SEASON_STATUSES, "upcoming")],
    }
    if (data.endsAt < data.startsAt) throw new AdminError("End date must not be before the start date.")
    if (data.status === "CURRENT") {
      // The database has no partial unique index yet (decisions notes); enforce one current season per league here.
      const clash = await db.season.count({ where: { leagueId: data.leagueId, status: "CURRENT", id: { not: seasonId } } })
      if (clash > 0) throw new AdminError("This league already has a current season. Mark that one completed or upcoming first.")
    }
    await write(() => db.season.upsert({ where: { id: seasonId }, create: { id: seasonId, ...data }, update: data }), {
      unique: "This league already has a season with that name.",
      reference: "The selected league does not exist.",
    })
  },

  async saveTeam(input: unknown): Promise<void> {
    const p = payload(input)
    const teamId = id(p)
    const data = {
      leagueId: id(p, "leagueId"),
      name: requiredText(p, "name", "Name"),
      shortName: requiredText(p, "shortName", "Short name", 60),
      code: requiredText(p, "code", "Code", 8).toUpperCase(),
      color: text(p, "color", "Brand colour", { max: 16 }) ?? null,
      logoUrl: text(p, "logoUrl", "Logo URL", { max: 2000 }) ?? null,
      status: toDbEntityStatus[oneOf(p, "status", "Status", ENTITY_STATUSES, "active")],
    }
    await write(() => db.team.upsert({ where: { id: teamId }, create: { id: teamId, ...data }, update: data }), {
      unique: "A team with this code already exists in that league.",
      reference: "The selected league does not exist.",
    })
  },

  async savePlayer(input: unknown): Promise<void> {
    const p = payload(input)
    const playerId = id(p)
    const data = {
      // Null for individual-sport athletes.
      teamId: text(p, "teamId", "Team") ?? null,
      name: requiredText(p, "name", "Full name"),
      handle: text(p, "handle", "Handle", { max: 60 }) ?? null,
      role: requiredText(p, "role", "Role", 60),
      nationality: text(p, "nationality", "Nationality", { max: 80 }) ?? null,
      number: optionalInt(p, "number", "Squad number") ?? null,
      status: toDbEntityStatus[oneOf(p, "status", "Status", ENTITY_STATUSES, "active")],
    }
    await write(() => db.player.upsert({ where: { id: playerId }, create: { id: playerId, ...data }, update: data }), {
      reference: "The selected team does not exist.",
    })
  },

  async saveVenue(input: unknown): Promise<void> {
    const p = payload(input)
    const venueId = id(p)
    const data = {
      name: requiredText(p, "name", "Name"),
      city: requiredText(p, "city", "City", 120),
      country: requiredText(p, "country", "Country", 120),
      capacity: optionalInt(p, "capacity", "Capacity") ?? null,
      status: toDbEntityStatus[oneOf(p, "status", "Status", ENTITY_STATUSES, "active")],
    }
    await write(() => db.venue.upsert({ where: { id: venueId }, create: { id: venueId, ...data }, update: data }))
  },

  /**
   * Writes the match row and replaces its participant set in one transaction.
   * Participant rules come from lib/data/match-participants.ts (shared with sync).
   */
  async saveMatch(input: unknown): Promise<void> {
    const p = payload(input)
    const matchId = id(p)
    const leagueId = id(p, "leagueId")
    const seasonId = id(p, "seasonId")
    const validation = validateParticipants(p.participants)
    if (!validation.ok) throw new AdminError(validation.error)
    const participants = validation.participants
    const score = p.score === undefined || p.score === null ? undefined : payload(p.score)
    const sideAScore = score ? optionalInt(score, "a", "Side A score") : undefined
    const sideBScore = score ? optionalInt(score, "b", "Side B score") : undefined
    if ((sideAScore === undefined) !== (sideBScore === undefined)) throw new AdminError("Enter both scores or neither.")
    const venueId = text(p, "venueId", "Venue") ?? null
    const status = toDbMatchStatus[oneOf(p, "status", "Status", MATCH_STATUSES, "upcoming")]
    const data = {
      leagueId,
      seasonId,
      venueId,
      startsAt: instant(p, "startsAt", "Start"),
      status,
      stage: text(p, "stage", "Stage", { max: 120 }) ?? null,
      sideAScore: sideAScore ?? null,
      sideBScore: sideBScore ?? null,
      liveDetail: status === "LIVE" ? (text(p, "liveDetail", "Live detail", { max: 60 }) ?? null) : null,
    }

    // Referential rules the schema cannot express: team participants and the season belong to the
    // match's league; player participants must exist (they need no team).
    const teamIds = participants.flatMap((x) => (x.teamId ? [x.teamId] : []))
    const playerIds = participants.flatMap((x) => (x.playerId ? [x.playerId] : []))
    const [teams, players, season] = await Promise.all([
      teamIds.length ? db.team.findMany({ where: { id: { in: teamIds } }, select: { id: true, leagueId: true } }) : [],
      playerIds.length ? db.player.findMany({ where: { id: { in: playerIds } }, select: { id: true } }) : [],
      db.season.findUnique({ where: { id: seasonId }, select: { leagueId: true } }),
    ])
    if (teams.length !== teamIds.length) throw new AdminError("One of the selected teams does not exist.")
    if (teams.some((team) => team.leagueId !== leagueId)) throw new AdminError("Every team must belong to the match's league.")
    if (players.length !== playerIds.length) throw new AdminError("One of the selected players does not exist.")
    if (!season) throw new AdminError("The selected season does not exist.")
    if (season.leagueId !== leagueId) throw new AdminError("The season must belong to the match's league.")

    await write(
      () =>
        db.$transaction([
          db.match.upsert({ where: { id: matchId }, create: { id: matchId, ...data }, update: data }),
          db.matchParticipant.deleteMany({ where: { matchId } }),
          db.matchParticipant.createMany({ data: participants.map((x) => ({ matchId, side: x.side, order: x.order, teamId: x.teamId ?? null, playerId: x.playerId ?? null })) }),
        ]),
      { reference: "The selected league, season, team, player, or venue does not exist." }
    )
  },

  async saveDataSource(input: unknown): Promise<void> {
    const p = payload(input)
    const sourceId = id(p)
    const data = {
      name: requiredText(p, "name", "Name"),
      sportId: sportId(p, "sport", { required: false }) ?? null,
      status: toDbDataSourceStatus[oneOf(p, "status", "Status", DATA_SOURCE_STATUSES, "connected")],
    }
    await write(() => db.dataSource.upsert({ where: { id: sourceId }, create: { id: sourceId, ...data }, update: data }), {
      reference: "The selected sport or game does not exist.",
    })
  },

  // -------------------------------------------------------------------------
  // Deletes: follow the schema's Restrict / SetNull / Cascade intent
  // -------------------------------------------------------------------------

  /** Blocked by the database while seasons, teams, or matches reference the league. */
  async deleteLeague(leagueId: string): Promise<void> {
    await write(() => db.league.delete({ where: { id: leagueId } }), {
      reference: "This league still has seasons, teams, or matches. Remove or reassign them first.",
      missing: "This league was already deleted.",
    })
  },

  /** Blocked while matches reference the season. */
  async deleteSeason(seasonId: string): Promise<void> {
    await write(() => db.season.delete({ where: { id: seasonId } }), {
      reference: "Matches still reference this season. Reassign them first.",
      missing: "This season was already deleted.",
    })
  },

  /**
   * Refuse while the team has players or match participations, rather than
   * orphaning roster rows or losing match history. Follows cascade.
   */
  async deleteTeam(teamId: string): Promise<void> {
    const [players, matches] = await Promise.all([
      db.player.count({ where: { teamId } }),
      db.matchParticipant.count({ where: { teamId } }),
    ])
    if (players > 0 || matches > 0) {
      throw new AdminError("This team still has players or matches. Reassign or delete them first.")
    }
    await write(() => db.team.delete({ where: { id: teamId } }), { missing: "This team was already deleted." })
  },

  /** Follows cascade; match participations block at the database (history is kept). */
  async deletePlayer(playerId: string): Promise<void> {
    await write(() => db.player.delete({ where: { id: playerId } }), {
      reference: "This player has taken part in matches and cannot be deleted. Set the status to inactive instead.",
      missing: "This player was already deleted.",
    })
  },

  /** Matches at the venue keep no venue (SetNull). */
  async deleteVenue(venueId: string): Promise<void> {
    await write(() => db.venue.delete({ where: { id: venueId } }), { missing: "This venue was already deleted." })
  },

  /** Watchlist rows cascade. */
  async deleteMatch(matchId: string): Promise<void> {
    await write(() => db.match.delete({ where: { id: matchId } }), { missing: "This match was already deleted." })
  },
}
