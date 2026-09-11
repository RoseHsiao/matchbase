import type { League, Sport, TeamView } from "@/lib/data/types"
import { ALL, leaguesForSport } from "@/lib/schedule"

/** Pure team browsing logic: filter state, search, and reconciliation. */

export type TeamFilterState = {
  query: string
  sport: Sport | typeof ALL
  leagueId: string
}

export const defaultTeamFilters: TeamFilterState = {
  query: "",
  sport: ALL,
  leagueId: ALL,
}

export function countActiveTeamFilters(filters: TeamFilterState): number {
  return (
    (filters.query.trim() ? 1 : 0) +
    (filters.sport !== ALL ? 1 : 0) +
    (filters.leagueId !== ALL ? 1 : 0)
  )
}

/** Case-insensitive match on name, short name, or abbreviation. */
export function matchesQuery(team: TeamView, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [team.name, team.shortName, team.code].some((value) =>
    value.toLowerCase().includes(needle)
  )
}

export function filterTeams(teams: TeamView[], filters: TeamFilterState): TeamView[] {
  return teams.filter(
    (team) =>
      (filters.sport === ALL || team.league.sport === filters.sport) &&
      (filters.leagueId === ALL || team.leagueId === filters.leagueId) &&
      matchesQuery(team, filters.query)
  )
}

/** Drop a league selection that no longer fits the chosen sport. */
export function reconcileTeamFilters(
  next: TeamFilterState,
  leagues: League[]
): TeamFilterState {
  if (
    next.leagueId !== ALL &&
    !leaguesForSport(leagues, next.sport).some((league) => league.id === next.leagueId)
  ) {
    return { ...next, leagueId: ALL }
  }
  return next
}
