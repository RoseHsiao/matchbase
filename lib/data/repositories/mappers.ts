import "server-only"

import type {
  EntityStatus,
  League,
  Match,
  MatchStatus,
  MatchView,
  Player,
  PlayerView,
  Season,
  SeasonStatus,
  Sport,
  Team,
  TeamView,
} from "@/lib/data/types"
import type {
  EntityStatus as DbEntityStatus,
  MatchStatus as DbMatchStatus,
  Season as DbSeason,
  SeasonStatus as DbSeasonStatus,
  Team as DbTeam,
} from "@/lib/generated/prisma/client"
import type {
  LeagueGetPayload,
  LeagueInclude,
  MatchGetPayload,
  MatchInclude,
  PlayerGetPayload,
  PlayerInclude,
  TeamGetPayload,
  TeamInclude,
} from "@/lib/generated/prisma/models"
import { sportMeta } from "@/lib/sports"

/**
 * Prisma persistence model -> application domain model (lib/data/types.ts).
 *
 * The UI keeps consuming the domain shapes; nothing outside lib/data sees a
 * Prisma type. Optional domain fields are `undefined`, never `null`, so the
 * existing `x !== undefined` and `x ?? fallback` checks keep working after the
 * records cross the server/client boundary.
 */

// ---------------------------------------------------------------------------
// Include shapes shared by the repositories
// ---------------------------------------------------------------------------

/**
 * The domain League carries a `season` label. The database has no such
 * column (decisions §3), so the label is derived from the league's seasons:
 * the current one, else the next upcoming, else the most recent completed.
 * PostgreSQL orders an enum by declaration order, and SeasonStatus is declared
 * CURRENT, UPCOMING, COMPLETED, which is exactly the app's ordering.
 */
export const leagueInclude = {
  seasons: {
    select: { name: true },
    orderBy: [{ status: "asc" }, { startsAt: "desc" }],
    take: 1,
  },
} satisfies LeagueInclude

export const teamInclude = {
  league: { include: leagueInclude },
} satisfies TeamInclude

export const playerInclude = {
  team: { include: teamInclude },
} satisfies PlayerInclude

export const matchInclude = {
  league: { include: leagueInclude },
  homeTeam: true,
  awayTeam: true,
  venue: { select: { name: true } },
} satisfies MatchInclude

export type LeagueRecord = LeagueGetPayload<{ include: typeof leagueInclude }>
export type TeamRecord = TeamGetPayload<{ include: typeof teamInclude }>
export type PlayerRecord = PlayerGetPayload<{ include: typeof playerInclude }>
export type MatchRecord = MatchGetPayload<{ include: typeof matchInclude }>

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

/**
 * Sport metadata (label, category, Home/Away wording) lives in the code
 * registry in v1 (decisions §2). A sport row the registry does not know
 * cannot be rendered, so fail loudly rather than crash inside a component.
 */
export function toSport(id: string): Sport {
  if (!(id in sportMeta)) {
    throw new Error(`Sport "${id}" exists in the database but not in the sport registry (lib/sports.ts).`)
  }
  return id as Sport
}

const entityStatus: Record<DbEntityStatus, EntityStatus> = {
  ACTIVE: "active",
  INACTIVE: "inactive",
}

const matchStatus: Record<DbMatchStatus, MatchStatus> = {
  UPCOMING: "upcoming",
  LIVE: "live",
  FINISHED: "finished",
}

const seasonStatus: Record<DbSeasonStatus, SeasonStatus> = {
  CURRENT: "current",
  UPCOMING: "upcoming",
  COMPLETED: "completed",
}

/** Same fallback the admin team form uses for a new team. */
const DEFAULT_TEAM_COLOR = "#334155"

function orUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value
}

/** A `date` column comes back as a Date at UTC midnight; the domain uses "YYYY-MM-DD". */
function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export function toLeague(record: LeagueRecord): League {
  return {
    id: record.id,
    name: record.name,
    shortName: record.shortName,
    sport: toSport(record.sportId),
    region: record.region ?? "",
    season: record.seasons[0]?.name ?? "",
    status: entityStatus[record.status],
  }
}

export function toSeason(record: DbSeason): Season {
  return {
    id: record.id,
    leagueId: record.leagueId,
    name: record.name,
    startsAt: toIsoDate(record.startsAt),
    endsAt: toIsoDate(record.endsAt),
    status: seasonStatus[record.status],
  }
}

export function toTeam(record: DbTeam): Team {
  return {
    id: record.id,
    name: record.name,
    shortName: record.shortName,
    code: record.code,
    leagueId: record.leagueId,
    color: record.color ?? DEFAULT_TEAM_COLOR,
    logoUrl: orUndefined(record.logoUrl),
    status: entityStatus[record.status],
  }
}

export function toTeamView(record: TeamRecord, nextMatch?: MatchView): TeamView {
  return {
    ...toTeam(record),
    league: toLeague(record.league),
    nextMatch,
  }
}

/**
 * The domain Player always has a team (lib/data/types.ts). The database allows
 * free agents (decisions §5); repositories exclude them from user-facing reads
 * until the domain type grows a nullable team.
 */
export function toPlayer(record: PlayerRecord): Player {
  if (record.teamId === null || record.team === null) {
    throw new Error(`Player "${record.id}" has no team and cannot be mapped to the domain Player type.`)
  }
  return {
    id: record.id,
    name: record.name,
    handle: orUndefined(record.handle),
    teamId: record.teamId,
    role: record.role ?? "",
    nationality: orUndefined(record.nationality),
    number: orUndefined(record.number),
    status: entityStatus[record.status],
  }
}

export function toPlayerView(record: PlayerRecord): PlayerView {
  const player = toPlayer(record)
  // toPlayer has already rejected a missing team.
  const team = record.team as NonNullable<PlayerRecord["team"]>
  return {
    ...player,
    team: toTeam(team),
    league: toLeague(team.league),
  }
}

export function toMatch(record: MatchRecord): Match {
  const hasScore = record.homeScore !== null && record.awayScore !== null
  return {
    id: record.id,
    leagueId: record.leagueId,
    homeTeamId: record.homeTeamId,
    awayTeamId: record.awayTeamId,
    startsAt: record.startsAt.toISOString(),
    status: matchStatus[record.status],
    stage: orUndefined(record.stage),
    venue: record.venue?.name,
    score: hasScore ? { home: record.homeScore as number, away: record.awayScore as number } : undefined,
    liveDetail: orUndefined(record.liveDetail),
  }
}

export function toMatchView(record: MatchRecord): MatchView {
  return {
    ...toMatch(record),
    league: toLeague(record.league),
    homeTeam: toTeam(record.homeTeam),
    awayTeam: toTeam(record.awayTeam),
  }
}
