import type { CatalogueSource } from "@/lib/data/catalogue-source"
import { buildDemoMatches, buildDemoSeasons, demoLeagues as leagues, demoPlayers as players, demoTeams as teams } from "@/lib/data/demo-fixtures"
import type { MatchQuery } from "@/lib/data/repositories/match-repository"
import type { League, Match, MatchView, Player, PlayerView, Season, Team, TeamView } from "@/lib/data/types"
import type { DemoClock } from "@/lib/demo-clock"
import { playerDisplayName } from "@/lib/players"
import { sports } from "@/lib/sports"

/**
 * The public demo catalogue: the fictional cast of lib/data/demo-fixtures.ts
 * laid over a clock, behind the same read interface as the database repositories, and held in memory. This
 * module must never import Prisma or anything that reaches the database, and
 * it has no write methods, so a demo visitor has no path to a real row or to
 * a mutation through it (tests/domain/demo-catalogue.test.ts checks both).
 *
 * The filters and orderings mirror the repositories exactly, so pages behave
 * the same on either source.
 */

/** Same grace as the team repository: a match stays a team's "next" until three hours after kick-off. */
const NEXT_MATCH_GRACE_MS = 3 * 3_600_000

const SEASON_ORDER: Record<Season["status"], number> = { current: 0, upcoming: 1, completed: 2 }

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name)
}

function byDisplayName<T extends Pick<Player, "name" | "handle">>(a: T, b: T): number {
  return playerDisplayName(a).localeCompare(playerDisplayName(b))
}

function byCatalogueOrder(a: League, b: League): number {
  return sports.indexOf(a.sport) - sports.indexOf(b.sport) || a.name.localeCompare(b.name)
}

function matchesStatus(match: Match, status: NonNullable<MatchQuery["status"]>): boolean {
  return typeof status === "string" ? match.status === status : match.status !== status.not
}

function matchesWindow(match: Match, window: NonNullable<MatchQuery["startsAt"]>): boolean {
  const start = Date.parse(match.startsAt)
  return (
    (window.gt === undefined || start > window.gt.getTime()) &&
    (window.gte === undefined || start >= window.gte.getTime()) &&
    (window.lt === undefined || start < window.lt.getTime())
  )
}

function involves(match: Match, teamIds: readonly string[] = [], playerIds: readonly string[] = []): boolean {
  return match.participants.some(
    (participant) =>
      (participant.teamId !== undefined && teamIds.includes(participant.teamId)) ||
      (participant.playerId !== undefined && playerIds.includes(participant.playerId))
  )
}

function matchesQuery(match: Match, query: MatchQuery): boolean {
  if (query.ids !== undefined && !query.ids.includes(match.id)) return false
  if (query.leagueId !== undefined && match.leagueId !== query.leagueId) return false
  if ((query.teamIds !== undefined || query.playerIds !== undefined) && !involves(match, query.teamIds, query.playerIds)) return false
  if (query.excludeId !== undefined && match.id === query.excludeId) return false
  if (query.status !== undefined && !matchesStatus(match, query.status)) return false
  if (query.startsAt !== undefined && !matchesWindow(match, query.startsAt)) return false
  if (query.followed !== undefined) {
    const { teamIds, playerIds, leagueIds } = query.followed
    if (!involves(match, teamIds, playerIds) && !leagueIds.includes(match.leagueId)) return false
  }
  return true
}

export function createDemoCatalogue(clock: DemoClock): CatalogueSource {
  const seasons = buildDemoSeasons(clock)
  const leagueById = new Map(leagues.map((league) => [league.id, league]))
  const teamById = new Map(teams.map((team) => [team.id, team]))
  const playerById = new Map(players.map((player) => [player.id, player]))

  function league(id: string): League {
    const found = leagueById.get(id)
    if (!found) throw new Error(`Demo data references unknown league "${id}".`)
    return found
  }

  const matchViews: MatchView[] = buildDemoMatches(clock).map((match) => ({
    ...match,
    league: league(match.leagueId),
    participants: match.participants.map((participant) => ({
      ...participant,
      team: participant.teamId === undefined ? undefined : teamById.get(participant.teamId),
      player: participant.playerId === undefined ? undefined : playerById.get(participant.playerId),
    })),
  }))

  function findViews(query: MatchQuery = {}): MatchView[] {
    const direction = query.order === "desc" ? -1 : 1
    const rows = matchViews
      .filter((match) => matchesQuery(match, query))
      .sort((a, b) => direction * a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id))
    return query.limit === undefined ? rows : rows.slice(0, query.limit)
  }

  function teamView(team: Team, now: Date): TeamView {
    const nextMatch = findViews({
      teamIds: [team.id],
      status: { not: "finished" },
      startsAt: { gt: new Date(now.getTime() - NEXT_MATCH_GRACE_MS) },
      limit: 1,
    })[0]
    return { ...team, league: league(team.leagueId), nextMatch }
  }

  function playerView(player: Player): PlayerView {
    const team = player.teamId === undefined ? undefined : teamById.get(player.teamId)
    // Individual athletes carry the league of their latest match, as in the repository.
    const latest = team ? undefined : findViews({ playerIds: [player.id], order: "desc", limit: 1 })[0]
    return { ...player, team, league: team ? league(team.leagueId) : latest?.league }
  }

  return {
    matches: {
      findViews: async (query) => findViews(query),
      findViewById: async (id) => matchViews.find((match) => match.id === id),
    },
    leagues: {
      findMany: async () => [...leagues].sort(byCatalogueOrder),
      findById: async (id) => leagueById.get(id),
      findByIds: async (ids) => leagues.filter((entry) => ids.includes(entry.id)),
    },
    seasons: {
      findByLeague: async (leagueId) =>
        seasons
          .filter((season) => season.leagueId === leagueId)
          .sort((a, b) => SEASON_ORDER[a.status] - SEASON_ORDER[b.status] || b.startsAt.localeCompare(a.startsAt)),
    },
    teams: {
      findMany: async () => [...teams].sort(byName),
      findViews: async (filter = {}, now = new Date()) =>
        teams
          .filter((team) => filter.leagueId === undefined || team.leagueId === filter.leagueId)
          .map((team) => teamView(team, now))
          .sort(byName),
      findViewById: async (id, now = new Date()) => {
        const team = teamById.get(id)
        return team ? teamView(team, now) : undefined
      },
    },
    players: {
      findViews: async () => players.map(playerView).sort(byDisplayName),
      findViewById: async (id) => {
        const player = playerById.get(id)
        return player ? playerView(player) : undefined
      },
      findByTeam: async (teamId) => players.filter((player) => player.teamId === teamId).sort(byDisplayName),
    },
  }
}
