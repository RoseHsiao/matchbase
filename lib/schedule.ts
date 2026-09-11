import type {
  League,
  MatchStatus,
  MatchView,
  Sport,
  Team,
} from "@/lib/data/types"
import { dayKey, startOfDay } from "@/lib/format"

/**
 * Pure schedule logic: filter state, filtering, and grouping.
 * Kept free of React so it can back a server-side query later.
 */

export const ALL = "all"

export type ScheduleFilterState = {
  sport: Sport | typeof ALL
  leagueId: string
  teamId: string
  status: MatchStatus | typeof ALL
}

export const defaultScheduleFilters: ScheduleFilterState = {
  sport: ALL,
  leagueId: ALL,
  teamId: ALL,
  status: ALL,
}

export function countActiveFilters(filters: ScheduleFilterState): number {
  return Object.values(filters).filter((value) => value !== ALL).length
}

export function filterMatches(
  matches: MatchView[],
  filters: ScheduleFilterState
): MatchView[] {
  return matches.filter(
    (match) =>
      (filters.sport === ALL || match.league.sport === filters.sport) &&
      (filters.leagueId === ALL || match.leagueId === filters.leagueId) &&
      (filters.teamId === ALL ||
        match.homeTeamId === filters.teamId ||
        match.awayTeamId === filters.teamId) &&
      (filters.status === ALL || match.status === filters.status)
  )
}

export function leaguesForSport(
  leagues: League[],
  sport: ScheduleFilterState["sport"]
): League[] {
  return sport === ALL
    ? leagues
    : leagues.filter((league) => league.sport === sport)
}

export function teamsForFilters(
  teams: Team[],
  leagues: League[],
  filters: Pick<ScheduleFilterState, "sport" | "leagueId">
): Team[] {
  const allowedLeagues = new Set(
    leaguesForSport(leagues, filters.sport)
      .filter((league) => filters.leagueId === ALL || league.id === filters.leagueId)
      .map((league) => league.id)
  )
  return teams.filter((team) => allowedLeagues.has(team.leagueId))
}

/** Drop league or team selections that no longer fit the broader filters. */
export function reconcileFilters(
  next: ScheduleFilterState,
  leagues: League[],
  teams: Team[]
): ScheduleFilterState {
  const result = { ...next }
  if (
    result.leagueId !== ALL &&
    !leaguesForSport(leagues, result.sport).some((l) => l.id === result.leagueId)
  ) {
    result.leagueId = ALL
  }
  if (
    result.teamId !== ALL &&
    !teamsForFilters(teams, leagues, result).some((t) => t.id === result.teamId)
  ) {
    result.teamId = ALL
  }
  return result
}

export type MatchDayGroup = {
  /** Local day key, see `dayKey`. */
  key: string
  date: Date
  matches: MatchView[]
}

/** Group matches by local calendar day, preserving start-time order. */
export function groupMatchesByDay(matches: MatchView[]): MatchDayGroup[] {
  const groups = new Map<string, MatchDayGroup>()
  for (const match of matches) {
    const key = dayKey(match.startsAt)
    const group = groups.get(key)
    if (group) {
      group.matches.push(match)
    } else {
      groups.set(key, { key, date: startOfDay(match.startsAt), matches: [match] })
    }
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))
}
