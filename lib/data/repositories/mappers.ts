import "server-only"

import type {
  EntityStatus,
  League,
  Match,
  MatchParticipant,
  MatchParticipantView,
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
  MatchParticipant as DbMatchParticipant,
  MatchStatus as DbMatchStatus,
  Player as DbPlayer,
  Season as DbSeason,
  SeasonStatus as DbSeasonStatus,
  Team as DbTeam,
} from "@/lib/generated/prisma/client"
import type {
  LeagueGetPayload,
  LeagueInclude,
  MatchGetPayload,
  MatchInclude,
  MatchParticipantFindManyArgs,
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

/**
 * A player's league is the team's league, or, for individual athletes, the
 * league of their most recent match.
 */
export const playerInclude = {
  team: { include: teamInclude },
  participations: {
    select: { match: { select: { league: { include: leagueInclude } } } },
    orderBy: { match: { startsAt: "desc" } },
    take: 1,
  },
} satisfies PlayerInclude

/** Participants in side/position order with whichever entity they reference. */
export const participantInclude = {
  include: { team: true, player: true },
  orderBy: [{ side: "asc" }, { order: "asc" }],
} satisfies MatchParticipantFindManyArgs

export const matchInclude = {
  league: { include: leagueInclude },
  venue: { select: { name: true } },
  participants: participantInclude,
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

export const entityStatus: Record<DbEntityStatus, EntityStatus> = {
  ACTIVE: "active",
  INACTIVE: "inactive",
}

export const matchStatus: Record<DbMatchStatus, MatchStatus> = {
  UPCOMING: "upcoming",
  LIVE: "live",
  FINISHED: "finished",
}

export const seasonStatus: Record<DbSeasonStatus, SeasonStatus> = {
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

export function toPlayer(record: DbPlayer): Player {
  return {
    id: record.id,
    name: record.name,
    handle: orUndefined(record.handle),
    teamId: orUndefined(record.teamId),
    role: record.role ?? "",
    nationality: orUndefined(record.nationality),
    number: orUndefined(record.number),
    status: entityStatus[record.status],
  }
}

export function toPlayerView(record: PlayerRecord): PlayerView {
  const leagueRecord = record.team?.league ?? record.participations[0]?.match.league
  return {
    ...toPlayer(record),
    team: record.team ? toTeam(record.team) : undefined,
    league: leagueRecord ? toLeague(leagueRecord) : undefined,
  }
}

export function toParticipant(record: DbMatchParticipant): MatchParticipant {
  return {
    id: record.id,
    side: record.side,
    order: record.order,
    teamId: orUndefined(record.teamId),
    playerId: orUndefined(record.playerId),
  }
}

export function toMatch(record: MatchRecord): Match {
  const hasScore = record.sideAScore !== null && record.sideBScore !== null
  return {
    id: record.id,
    leagueId: record.leagueId,
    seasonId: record.seasonId,
    participants: record.participants.map(toParticipant),
    startsAt: record.startsAt.toISOString(),
    status: matchStatus[record.status],
    stage: orUndefined(record.stage),
    venue: record.venue?.name,
    venueId: orUndefined(record.venueId),
    score: hasScore ? { a: record.sideAScore as number, b: record.sideBScore as number } : undefined,
    liveDetail: orUndefined(record.liveDetail),
  }
}

export function toMatchView(record: MatchRecord): MatchView {
  const participants: MatchParticipantView[] = record.participants.map((p) => ({
    ...toParticipant(p),
    team: p.team ? toTeam(p.team) : undefined,
    player: p.player ? toPlayer(p.player) : undefined,
  }))
  return {
    ...toMatch(record),
    league: toLeague(record.league),
    participants,
  }
}
