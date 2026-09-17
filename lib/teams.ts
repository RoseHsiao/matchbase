import type { Category, Sport, TeamView } from "@/lib/data/types"
import type { HierarchyRef } from "@/lib/hierarchy"
import { ALL } from "@/lib/schedule"
import { sportCategory } from "@/lib/sports"

/**
 * Pure team browsing logic: filter state and search. Option narrowing and
 * reconciliation are the shared hierarchy behaviour in lib/schedule.ts;
 * grouping is lib/hierarchy.ts.
 */

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

/** Where a team sits in Category → Sport/Game → League. */
export function teamHierarchyRef(team: TeamView): HierarchyRef {
  return { sport: team.league.sport, league: { id: team.league.id, name: team.league.name } }
}
