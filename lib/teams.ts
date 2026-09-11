import type { Category, League, Sport, TeamView } from "@/lib/data/types"
import { ALL, reconcileHierarchy } from "@/lib/schedule"
import { sportCategory } from "@/lib/sports"

/** Pure team browsing logic: filter state, search, and reconciliation. */

export type TeamFilterState = {
  query: string
  category: Category | typeof ALL
  sport: Sport | typeof ALL
  leagueId: string
}

export const defaultTeamFilters: TeamFilterState = {
  query: "",
  category: ALL,
  sport: ALL,
  leagueId: ALL,
}

export function countActiveTeamFilters(filters: TeamFilterState): number {
  return (
    (filters.query.trim() ? 1 : 0) +
    (filters.category !== ALL ? 1 : 0) +
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
      (filters.category === ALL ||
        sportCategory(team.league.sport) === filters.category) &&
      (filters.sport === ALL || team.league.sport === filters.sport) &&
      (filters.leagueId === ALL || team.leagueId === filters.leagueId) &&
      matchesQuery(team, filters.query)
  )
}

/** Drop selections that no longer fit the broader filters. */
export function reconcileTeamFilters(
  next: TeamFilterState,
  leagues: League[]
): TeamFilterState {
  return reconcileHierarchy(next, leagues)
}
