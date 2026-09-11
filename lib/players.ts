import type { Category, League, PlayerView, Sport, Team } from "@/lib/data/types"
import { ALL, reconcileHierarchy } from "@/lib/schedule"
import { sportCategory } from "@/lib/sports"

/** Pure player browsing logic: filter state, search, and reconciliation. */

export type PlayerFilterState = {
  query: string
  category: Category | typeof ALL
  sport: Sport | typeof ALL
  leagueId: string
  teamId: string
}

export const defaultPlayerFilters: PlayerFilterState = {
  query: "",
  category: ALL,
  sport: ALL,
  leagueId: ALL,
  teamId: ALL,
}

export function countActivePlayerFilters(filters: PlayerFilterState): number {
  return (
    (filters.query.trim() ? 1 : 0) +
    (filters.category !== ALL ? 1 : 0) +
    (filters.sport !== ALL ? 1 : 0) +
    (filters.leagueId !== ALL ? 1 : 0) +
    (filters.teamId !== ALL ? 1 : 0)
  )
}

/** Display name: the in-game handle for esports players, otherwise the full name. */
export function playerDisplayName(player: Pick<PlayerView, "name" | "handle">): string {
  return player.handle ?? player.name
}

/** Case-insensitive match on real name or handle. */
export function matchesPlayerQuery(player: PlayerView, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [player.name, player.handle ?? ""].some((value) =>
    value.toLowerCase().includes(needle)
  )
}

export function filterPlayers(
  players: PlayerView[],
  filters: PlayerFilterState
): PlayerView[] {
  return players.filter(
    (player) =>
      (filters.category === ALL ||
        sportCategory(player.league.sport) === filters.category) &&
      (filters.sport === ALL || player.league.sport === filters.sport) &&
      (filters.leagueId === ALL || player.team.leagueId === filters.leagueId) &&
      (filters.teamId === ALL || player.teamId === filters.teamId) &&
      matchesPlayerQuery(player, filters.query)
  )
}

/** Drop selections that no longer fit the broader filters. */
export function reconcilePlayerFilters(
  next: PlayerFilterState,
  leagues: readonly League[],
  teams: readonly Team[]
): PlayerFilterState {
  return reconcileHierarchy(next, leagues, teams)
}
