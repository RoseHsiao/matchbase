import {
  currentUserFollows,
  leagues,
  matches,
  players,
  teams,
} from "@/lib/data/mock"
import type {
  League,
  Match,
  MatchStatus,
  MatchView,
  Player,
  QuickStats,
  Team,
  TeamView,
} from "@/lib/data/types"
import { addDays, isSameDay, startOfDay } from "@/lib/format"

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

/** Followed teams with their next scheduled match attached. */
export async function getFollowedTeams(now = new Date()): Promise<TeamView[]> {
  const list = currentUserFollows.teamIds.map((id) =>
    must(teamById.get(id), `team ${id}`)
  )
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

export async function getTeams(): Promise<Team[]> {
  return [...teams].sort((a, b) => a.name.localeCompare(b.name))
}

export async function getQuickStats(now = new Date()): Promise<QuickStats> {
  const follows = currentUserFollows
  const teamsPlayingToday = follows.teamIds.filter((teamId) =>
    matches.some(
      (match) =>
        isSameDay(match.startsAt, now) &&
        (match.homeTeamId === teamId || match.awayTeamId === teamId)
    )
  ).length

  return {
    followedTeams: follows.teamIds.length,
    followedPlayers: follows.playerIds.length,
    followedLeagues: follows.leagueIds.length,
    teamsPlayingToday,
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

export async function getTeamMatches(teamId: string): Promise<MatchView[]> {
  return matches
    .filter((match) => match.homeTeamId === teamId || match.awayTeamId === teamId)
    .sort(byStartTime)
    .map(toMatchView)
}

export async function getTeamPlayers(teamId: string): Promise<Player[]> {
  return players.filter((player) => player.teamId === teamId)
}

export async function isTeamFollowed(teamId: string): Promise<boolean> {
  return currentUserFollows.teamIds.includes(teamId)
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
