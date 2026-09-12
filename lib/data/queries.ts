import {
  adminActivity,
  currentUserFollows,
  dataSources,
  leagues,
  matches,
  players,
  seasons,
  syncLogs,
  teams,
  venues,
} from "@/lib/data/mock"
import type {
  AdminData,
  League,
  Match,
  MatchStatus,
  MatchView,
  Player,
  PlayerView,
  QuickStats,
  Season,
  Team,
  TeamView,
} from "@/lib/data/types"
import { addDays, isSameDay, startOfDay } from "@/lib/format"
import { sports } from "@/lib/sports"

/**
 * Read-side data access. Every function is async so the mock store can be
 * swapped for a real database without changing call sites.
 */

const leagueById = new Map(leagues.map((league) => [league.id, league]))
const teamById = new Map(teams.map((team) => [team.id, team]))

const STATUS_ORDER: Record<MatchStatus, number> = {
  live: 0,
  upcoming: 1,
  finished: 2,
}

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing ${label} in mock data.`)
  return value
}

function toMatchView(match: Match): MatchView {
  return {
    ...match,
    league: must(leagueById.get(match.leagueId), `league ${match.leagueId}`),
    homeTeam: must(teamById.get(match.homeTeamId), `team ${match.homeTeamId}`),
    awayTeam: must(teamById.get(match.awayTeamId), `team ${match.awayTeamId}`),
  }
}

function byStartTime(a: Match, b: Match): number {
  return a.startsAt.localeCompare(b.startsAt)
}

function byStatusThenStart(a: Match, b: Match): number {
  return STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || byStartTime(a, b)
}

function involvesFollowedTeam(match: Match): boolean {
  const { teamIds } = currentUserFollows
  return teamIds.includes(match.homeTeamId) || teamIds.includes(match.awayTeamId)
}

function isFollowedLeague(match: Match): boolean {
  return currentUserFollows.leagueIds.includes(match.leagueId)
}

function isFollowed(match: Match): boolean {
  return involvesFollowedTeam(match) || isFollowedLeague(match)
}

/** All of today's matches in followed leagues or with followed teams. Live first. */
export async function getTodaysMatches(now = new Date()): Promise<MatchView[]> {
  return matches
    .filter((match) => isSameDay(match.startsAt, now) && isFollowed(match))
    .sort(byStatusThenStart)
    .map(toMatchView)
}

/**
 * Next upcoming matches involving followed teams, starting tomorrow.
 * Today's matches are excluded because the dashboard shows them separately.
 */
export async function getUpcomingFollowedMatches(
  limit = 5,
  now = new Date()
): Promise<MatchView[]> {
  return matches
    .filter(
      (match) =>
        match.status === "upcoming" &&
        !isSameDay(match.startsAt, now) &&
        new Date(match.startsAt) > now &&
        involvesFollowedTeam(match)
    )
    .sort(byStartTime)
    .slice(0, limit)
    .map(toMatchView)
}

/** Ids of teams the user follows. Seeds the client follows store. */
export async function getFollowedTeamIds(): Promise<string[]> {
  return [...currentUserFollows.teamIds]
}

/** Ids of players the user follows. Seeds the client player-follows store. */
export async function getFollowedPlayerIds(): Promise<string[]> {
  return [...currentUserFollows.playerIds]
}

function toPlayerView(player: Player): PlayerView {
  const team = must(teamById.get(player.teamId), `team ${player.teamId}`)
  return {
    ...player,
    team,
    league: must(leagueById.get(team.leagueId), `league ${team.leagueId}`),
  }
}

/** Every player with their team and league, sorted by display name. */
export async function getPlayerViews(): Promise<PlayerView[]> {
  return players
    .map(toPlayerView)
    .sort((a, b) => (a.handle ?? a.name).localeCompare(b.handle ?? b.name))
}

export async function getPlayerById(id: string): Promise<PlayerView | undefined> {
  const player = players.find((entry) => entry.id === id)
  return player ? toPlayerView(player) : undefined
}

/** Every team with its league and next match, sorted by name. */
export async function getTeamViews(now = new Date()): Promise<TeamView[]> {
  const list = [...teams].sort((a, b) => a.name.localeCompare(b.name))
  return toTeamViews(list, now)
}

/** Ids the user has saved. Seeds the client watchlist store. */
export async function getWatchlistIds(): Promise<string[]> {
  return [...currentUserFollows.watchlistMatchIds]
}

/** Every known match in start order. Client views filter this by saved ids. */
export async function getMatches(): Promise<MatchView[]> {
  return [...matches].sort(byStartTime).map(toMatchView)
}

/** Every match from the start of today through the next `days` days, in start order. */
export async function getScheduleMatches(
  days = 7,
  now = new Date()
): Promise<MatchView[]> {
  const from = startOfDay(now)
  const to = addDays(from, days)
  return matches
    .filter((match) => {
      const startsAt = new Date(match.startsAt)
      return startsAt >= from && startsAt < to
    })
    .sort(byStartTime)
    .map(toMatchView)
}

export async function getLeagues(): Promise<League[]> {
  return leagues
}

export async function getLeagueById(id: string): Promise<League | undefined> {
  return leagueById.get(id)
}

/** Seasons for a league, current first, then upcoming, then completed. */
export async function getLeagueSeasons(leagueId: string): Promise<Season[]> {
  const order: Record<Season["status"], number> = { current: 0, upcoming: 1, completed: 2 }
  return seasons
    .filter((season) => season.leagueId === leagueId)
    .sort((a, b) => order[a.status] - order[b.status] || b.startsAt.localeCompare(a.startsAt))
}

/** Teams in a league with their next match, sorted by name. */
export async function getLeagueTeamViews(leagueId: string, now = new Date()): Promise<TeamView[]> {
  const list = teams
    .filter((team) => team.leagueId === leagueId)
    .sort((a, b) => a.name.localeCompare(b.name))
  return toTeamViews(list, now)
}

/** Live and upcoming matches in a league, soonest first. */
export async function getLeagueFixtures(leagueId: string, now = new Date()): Promise<MatchView[]> {
  const cutoff = new Date(now.getTime() - 3 * 3_600_000)
  return matches
    .filter((match) => match.leagueId === leagueId)
    .filter((match) => match.status !== "finished" && new Date(match.startsAt) > cutoff)
    .sort(byStartTime)
    .map(toMatchView)
}

/** Finished matches in a league, most recent first. */
export async function getLeagueResults(leagueId: string, limit?: number): Promise<MatchView[]> {
  const list = matches
    .filter((match) => match.leagueId === leagueId && match.status === "finished")
    .sort((a, b) => byStartTime(b, a))
    .map(toMatchView)
  return limit === undefined ? list : list.slice(0, limit)
}

/** Every finished match, most recent first. Backs the History page. */
export async function getFinishedMatches(): Promise<MatchView[]> {
  return matches
    .filter((match) => match.status === "finished")
    .sort((a, b) => byStartTime(b, a))
    .map(toMatchView)
}

export async function getTeams(): Promise<Team[]> {
  return [...teams].sort((a, b) => a.name.localeCompare(b.name))
}

export async function getQuickStats(): Promise<QuickStats> {
  const follows = currentUserFollows

  return {
    followedLeagues: follows.leagueIds.length,
    followedSports: [
      ...new Set(
        follows.leagueIds.map(
          (id) => must(leagueById.get(id), `league ${id}`).sport
        )
      ),
    ],
  }
}

export async function getMatchById(id: string): Promise<MatchView | undefined> {
  const match = matches.find((entry) => entry.id === id)
  return match ? toMatchView(match) : undefined
}

/** Other upcoming matches in the same league, soonest first. */
export async function getRelatedMatches(
  match: Match,
  limit = 4,
  now = new Date()
): Promise<MatchView[]> {
  return matches
    .filter(
      (entry) =>
        entry.id !== match.id &&
        entry.leagueId === match.leagueId &&
        entry.status === "upcoming" &&
        new Date(entry.startsAt) > now
    )
    .sort(byStartTime)
    .slice(0, limit)
    .map(toMatchView)
}

export async function getTeamById(id: string): Promise<TeamView | undefined> {
  const team = teamById.get(id)
  if (!team) return undefined
  const [view] = toTeamViews([team])
  return view
}

function involvesTeam(teamId: string) {
  return (match: Match) =>
    match.homeTeamId === teamId || match.awayTeamId === teamId
}

/** Live and upcoming matches for a team, soonest first. */
export async function getTeamFixtures(
  teamId: string,
  now = new Date()
): Promise<MatchView[]> {
  const cutoff = new Date(now.getTime() - 3 * 3_600_000)
  return matches
    .filter(involvesTeam(teamId))
    .filter(
      (match) => match.status !== "finished" && new Date(match.startsAt) > cutoff
    )
    .sort(byStartTime)
    .map(toMatchView)
}

/** Finished matches for a team, most recent first. */
export async function getTeamResults(
  teamId: string,
  limit?: number
): Promise<MatchView[]> {
  const list = matches
    .filter(involvesTeam(teamId))
    .filter((match) => match.status === "finished")
    .sort((a, b) => byStartTime(b, a))
    .map(toMatchView)
  return limit === undefined ? list : list.slice(0, limit)
}

export async function getTeamPlayers(teamId: string): Promise<Player[]> {
  return players.filter((player) => player.teamId === teamId)
}

function toTeamViews(list: Team[], now = new Date()): TeamView[] {
  // Treat a match as "next" until three hours after kick-off so a live game
  // still shows on the team card.
  const cutoff = new Date(now.getTime() - 3 * 3_600_000)
  return list.map((team) => ({
    ...team,
    league: must(leagueById.get(team.leagueId), `league ${team.leagueId}`),
    nextMatch: matches
      .filter(
        (match) =>
          match.status !== "finished" &&
          new Date(match.startsAt) > cutoff &&
          (match.homeTeamId === team.id || match.awayTeamId === team.id)
      )
      .sort(byStartTime)
      .map(toMatchView)[0],
  }))
}

/** Everything the admin area manages, as plain records. Seeds the admin client store. */
export async function getAdminData(): Promise<AdminData> {
  return {
    sports: sports.map((id) => ({ id, status: "active" })),
    leagues: [...leagues],
    seasons: [...seasons],
    teams: [...teams],
    players: [...players],
    matches: [...matches],
    venues: [...venues],
    dataSources: [...dataSources],
    syncLogs: [...syncLogs],
    activity: [...adminActivity],
  }
}
