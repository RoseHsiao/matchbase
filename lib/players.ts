import type { Category, PlayerView, Sport } from "@/lib/data/types"
import type { HierarchyRef } from "@/lib/hierarchy"
import { ALL } from "@/lib/schedule"
import { sportCategory } from "@/lib/sports"

/**
 * Pure player browsing logic: filter state and search. Option narrowing and
 * reconciliation are the shared hierarchy behaviour in lib/schedule.ts;
 * grouping is lib/hierarchy.ts.
 */

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
  // A player without a league (no team, no matches yet) only matches unfiltered hierarchy levels.
  return players.filter(
    (player) =>
      (filters.category === ALL ||
        (player.league !== undefined && sportCategory(player.league.sport) === filters.category)) &&
      (filters.sport === ALL || player.league?.sport === filters.sport) &&
      (filters.leagueId === ALL || player.league?.id === filters.leagueId) &&
      (filters.teamId === ALL || player.teamId === filters.teamId) &&
      matchesPlayerQuery(player, filters.query)
  )
}

/**
 * Where a player sits in Category → Sport/Game → League: the league of their
 * team, or for a team-less athlete the league of their matches. Undefined
 * only for a player with neither, who is then listed without hierarchy
 * rather than hidden.
 */
export function playerHierarchyRef(player: PlayerView): HierarchyRef | undefined {
  const { league } = player
  return league ? { sport: league.sport, league: { id: league.id, name: league.name } } : undefined
}
