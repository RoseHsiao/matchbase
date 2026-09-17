"use client"

import { CollectionBrowser } from "@/components/collection/collection-browser"
import { useHierarchyFilters } from "@/components/filters/hierarchy-filters"
import { PlayerCard } from "@/components/players/player-card"
import { usePlayerFollows } from "@/components/players/player-follows-provider"
import type { League, PlayerView, Team } from "@/lib/data/types"
import { groupByHierarchy } from "@/lib/hierarchy"
import { defaultPlayerFilters, filterPlayers, playerHierarchyRef } from "@/lib/players"

type PlayersViewProps = {
  players: PlayerView[]
  leagues: League[]
  teams: Team[]
}

const noun = { one: "player", other: "players" }

/**
 * Every player across sports and esports, including team-less athletes:
 * searched and filtered client-side, then grouped along
 * Category → Sport/Game → League. A player's position in the hierarchy comes
 * from their team's league or, without a team, from the league they play in.
 */
export function PlayersView({ players, leagues, teams }: PlayersViewProps) {
  const hierarchy = useHierarchyFilters(defaultPlayerFilters, leagues, teams)
  const { ids: followedIds } = usePlayerFollows()

  const visible = filterPlayers(players, hierarchy.filters)
  const grouped = groupByHierarchy(visible, playerHierarchyRef, hierarchy.filters)
  const followedCount = visible.filter((player) => followedIds.has(player.id)).length

  return (
    <CollectionBrowser
      idPrefix="players"
      searchPlaceholder="Player name or handle"
      hierarchy={hierarchy}
      showTeamFilter
      grouped={grouped}
      followedCount={followedCount}
      noun={noun}
      itemKey={(player) => player.id}
      renderItem={(player) => <PlayerCard player={player} showHierarchy={false} className="h-full" />}
      emptyTitle="No players found"
    />
  )
}
