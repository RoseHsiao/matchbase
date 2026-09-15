import { cache } from "react"

import { getCurrentUserId } from "@/lib/data/current-user"
import { adminRepository } from "@/lib/data/repositories/admin-repository"
import { leagueRepository } from "@/lib/data/repositories/league-repository"
import { matchRepository } from "@/lib/data/repositories/match-repository"
import { playerRepository } from "@/lib/data/repositories/player-repository"
import { seasonRepository } from "@/lib/data/repositories/season-repository"
import { teamRepository } from "@/lib/data/repositories/team-repository"
import { userStateRepository } from "@/lib/data/repositories/user-state-repository"
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
  UserFollows,
} from "@/lib/data/types"
import { addDays, startOfDay } from "@/lib/format"

/**
 * Read-side data access: the application-facing query API.
 *
 * Catalogue reads (leagues, seasons, teams, players, matches), the current
 * user's follows and watchlist, and the admin snapshot all go through the
 * repositories in lib/data/repositories, which query PostgreSQL through
 * Prisma. Pages and server components call these functions; nothing outside
 * lib/data touches Prisma. Writes live in lib/data/user-state-actions.ts and
 * lib/data/admin-actions.ts.
 *
 * Day boundaries ("today", the schedule window) are computed with the shared
 * helpers in lib/format.ts, exactly as before, so the database filters use
 * the same boundaries the mock filters did.
 */

/**
 * The current user's follows and watchlist, read once per request. React's
 * `cache` is request-scoped, so nothing user-specific outlives the request
 * or leaks between users once authentication exists.
 */
const getCurrentUserFollows = cache(
  async (): Promise<UserFollows> => userStateRepository.getFollows(await getCurrentUserId())
)

const STATUS_ORDER: Record<MatchStatus, number> = {
  live: 0,
  upcoming: 1,
  finished: 2,
}

/** A match counts as upcoming for a team or league until three hours after kick-off. */
const FIXTURE_GRACE_MS = 3 * 3_600_000

function byStartTime(a: Match, b: Match): number {
  return a.startsAt.localeCompare(b.startsAt)
}

function byStatusThenStart(a: Match, b: Match): number {
  return STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || byStartTime(a, b)
}

/** [start of the local day containing `now`, start of the next day) */
function dayWindow(now: Date): { gte: Date; lt: Date } {
  const gte = startOfDay(now)
  return { gte, lt: addDays(gte, 1) }
}

/** All of today's matches in followed leagues or with followed teams. Live first. */
export async function getTodaysMatches(now = new Date()): Promise<MatchView[]> {
  const { teamIds, leagueIds } = await getCurrentUserFollows()
  const matches = await matchRepository.findViews({
    startsAt: dayWindow(now),
    followed: { teamIds, leagueIds },
  })
  return matches.sort(byStatusThenStart)
}

/**
 * Next upcoming matches involving followed teams, starting tomorrow.
 * Today's matches are excluded because the dashboard shows them separately.
 */
export async function getUpcomingFollowedMatches(
  limit = 5,
  now = new Date()
): Promise<MatchView[]> {
  const { teamIds } = await getCurrentUserFollows()
  return matchRepository.findViews({
    status: "upcoming",
    startsAt: { gte: dayWindow(now).lt },
    teamIds,
    limit,
  })
}

/** Ids of teams the user follows. Seeds the client follows store. */
export async function getFollowedTeamIds(): Promise<string[]> {
  return (await getCurrentUserFollows()).teamIds
}

/** Ids of players the user follows. Seeds the client player-follows store. */
export async function getFollowedPlayerIds(): Promise<string[]> {
  return (await getCurrentUserFollows()).playerIds
}

/** Ids of leagues the user follows. No UI toggles this yet; the dashboard filters on it. */
export async function getFollowedLeagueIds(): Promise<string[]> {
  return (await getCurrentUserFollows()).leagueIds
}

/** Every player with their team and league, sorted by display name. */
export async function getPlayerViews(): Promise<PlayerView[]> {
  return playerRepository.findViews()
}

export async function getPlayerById(id: string): Promise<PlayerView | undefined> {
  return playerRepository.findViewById(id)
}

/** Every team with its league and next match, sorted by name. */
export async function getTeamViews(now = new Date()): Promise<TeamView[]> {
  return teamRepository.findViews({}, now)
}

/** Ids the user has saved. Seeds the client watchlist store. */
export async function getWatchlistIds(): Promise<string[]> {
  return (await getCurrentUserFollows()).watchlistMatchIds
}

/** Every known match in start order. Client views filter this by saved ids. */
export async function getMatches(): Promise<MatchView[]> {
  return matchRepository.findViews()
}

/** Every match from the start of today through the next `days` days, in start order. */
export async function getScheduleMatches(
  days = 7,
  now = new Date()
): Promise<MatchView[]> {
  const from = startOfDay(now)
  return matchRepository.findViews({ startsAt: { gte: from, lt: addDays(from, days) } })
}

export async function getLeagues(): Promise<League[]> {
  return leagueRepository.findMany()
}

export async function getLeagueById(id: string): Promise<League | undefined> {
  return leagueRepository.findById(id)
}

/** Seasons for a league, current first, then upcoming, then completed. */
export async function getLeagueSeasons(leagueId: string): Promise<Season[]> {
  return seasonRepository.findByLeague(leagueId)
}

/** Teams in a league with their next match, sorted by name. */
export async function getLeagueTeamViews(leagueId: string, now = new Date()): Promise<TeamView[]> {
  return teamRepository.findViews({ leagueId }, now)
}

/** Live and upcoming matches in a league, soonest first. */
export async function getLeagueFixtures(leagueId: string, now = new Date()): Promise<MatchView[]> {
  return matchRepository.findViews({
    leagueId,
    status: { not: "finished" },
    startsAt: { gt: new Date(now.getTime() - FIXTURE_GRACE_MS) },
  })
}

/** Finished matches in a league, most recent first. */
export async function getLeagueResults(leagueId: string, limit?: number): Promise<MatchView[]> {
  return matchRepository.findViews({ leagueId, status: "finished", order: "desc", limit })
}

/** Every finished match, most recent first. Backs the History page. */
export async function getFinishedMatches(): Promise<MatchView[]> {
  return matchRepository.findViews({ status: "finished", order: "desc" })
}

export async function getTeams(): Promise<Team[]> {
  return teamRepository.findMany()
}

export async function getQuickStats(): Promise<QuickStats> {
  const follows = await getCurrentUserFollows()
  const followedLeagues = await leagueRepository.findByIds(follows.leagueIds)

  return {
    followedLeagues: follows.leagueIds.length,
    followedSports: [...new Set(followedLeagues.map((league) => league.sport))],
  }
}

export async function getMatchById(id: string): Promise<MatchView | undefined> {
  return matchRepository.findViewById(id)
}

/** Other upcoming matches in the same league, soonest first. */
export async function getRelatedMatches(
  match: Match,
  limit = 4,
  now = new Date()
): Promise<MatchView[]> {
  return matchRepository.findViews({
    leagueId: match.leagueId,
    excludeId: match.id,
    status: "upcoming",
    startsAt: { gt: now },
    limit,
  })
}

export async function getTeamById(id: string): Promise<TeamView | undefined> {
  return teamRepository.findViewById(id)
}

/** Live and upcoming matches for a team, soonest first. */
export async function getTeamFixtures(
  teamId: string,
  now = new Date()
): Promise<MatchView[]> {
  return matchRepository.findViews({
    teamIds: [teamId],
    status: { not: "finished" },
    startsAt: { gt: new Date(now.getTime() - FIXTURE_GRACE_MS) },
  })
}

/** Finished matches for a team, most recent first. */
export async function getTeamResults(
  teamId: string,
  limit?: number
): Promise<MatchView[]> {
  return matchRepository.findViews({ teamIds: [teamId], status: "finished", order: "desc", limit })
}

export async function getTeamPlayers(teamId: string): Promise<Player[]> {
  return playerRepository.findByTeam(teamId)
}

/**
 * Everything the admin area manages, as plain records from the database.
 * Seeds the admin client store; the same rows back the user-facing pages.
 */
export async function getAdminData(): Promise<AdminData> {
  return adminRepository.getAll()
}
