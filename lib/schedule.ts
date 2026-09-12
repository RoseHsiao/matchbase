import type {
  Category,
  League,
  MatchStatus,
  MatchView,
  Sport,
  Team,
} from "@/lib/data/types"
import { dayKey, startOfDay } from "@/lib/format"
import { sportCategory, sports } from "@/lib/sports"

/**
 * Pure schedule logic: filter state, filtering, and grouping.
 * Kept free of React so it can back a server-side query later.
 */

export const ALL = "all"

export type ScheduleFilterState = {
  category: Category | typeof ALL
  sport: Sport | typeof ALL
  leagueId: string
  teamId: string
  status: MatchStatus | typeof ALL
}

export const defaultScheduleFilters: ScheduleFilterState = {
  category: ALL,
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
      (filters.category === ALL ||
        sportCategory(match.league.sport) === filters.category) &&
      (filters.sport === ALL || match.league.sport === filters.sport) &&
      (filters.leagueId === ALL || match.leagueId === filters.leagueId) &&
      (filters.teamId === ALL ||
        match.homeTeamId === filters.teamId ||
        match.awayTeamId === filters.teamId) &&
      (filters.status === ALL || match.status === filters.status)
  )
}

/** Hierarchy filters shared by schedule, teams, and players. */
export type HierarchyFilters = {
  category: Category | typeof ALL
  sport: Sport | typeof ALL
}

export function sportsForCategory(category: Category | typeof ALL): Sport[] {
  return category === ALL
    ? sports
    : sports.filter((sport) => sportCategory(sport) === category)
}

export function leaguesForFilters(
  leagues: readonly League[],
  filters: HierarchyFilters
): League[] {
  return leagues.filter(
    (league) =>
      (filters.category === ALL ||
        sportCategory(league.sport) === filters.category) &&
      (filters.sport === ALL || league.sport === filters.sport)
  )
}

export function teamsForFilters(
  teams: readonly Team[],
  leagues: readonly League[],
  filters: HierarchyFilters & { leagueId: string }
): Team[] {
  const allowedLeagues = new Set(
    leaguesForFilters(leagues, filters)
      .filter((league) => filters.leagueId === ALL || league.id === filters.leagueId)
      .map((league) => league.id)
  )
  return teams.filter((team) => allowedLeagues.has(team.leagueId))
}

/**
 * Drop narrower selections that no longer fit the broader ones:
 * category → sport → league → team. Works for any filter state that carries
 * the hierarchy fields; `teamId` is reconciled only when `teams` is given.
 */
export function reconcileHierarchy<
  T extends HierarchyFilters & { leagueId: string; teamId?: string },
>(next: T, leagues: readonly League[], teams?: readonly Team[]): T {
  const result = { ...next }
  if (result.sport !== ALL && !sportsForCategory(result.category).includes(result.sport)) {
    result.sport = ALL
  }
  if (
    result.leagueId !== ALL &&
    !leaguesForFilters(leagues, result).some((l) => l.id === result.leagueId)
  ) {
    result.leagueId = ALL
  }
  if (
    teams &&
    result.teamId !== undefined &&
    result.teamId !== ALL &&
    !teamsForFilters(teams, leagues, result).some((t) => t.id === result.teamId)
  ) {
    result.teamId = ALL
  }
  return result
}

export function reconcileFilters(
  next: ScheduleFilterState,
  leagues: readonly League[],
  teams: readonly Team[]
): ScheduleFilterState {
  return reconcileHierarchy(next, leagues, teams)
}

export type MatchDayGroup = {
  /** Local day key, see `dayKey`. */
  key: string
  date: Date
  matches: MatchView[]
}

/** Group matches by local calendar day. "desc" puts the newest day and match first. */
export function groupMatchesByDay(
  matches: MatchView[],
  order: "asc" | "desc" = "asc"
): MatchDayGroup[] {
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
  const factor = order === "asc" ? 1 : -1
  return [...groups.values()]
    .map((group) => ({
      ...group,
      matches: [...group.matches].sort(
        (a, b) => a.startsAt.localeCompare(b.startsAt) * factor
      ),
    }))
    .sort((a, b) => a.key.localeCompare(b.key) * factor)
}
