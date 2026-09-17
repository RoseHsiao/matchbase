"use client"

import { CollectionBrowser } from "@/components/collection/collection-browser"
import { useHierarchyFilters } from "@/components/filters/hierarchy-filters"
import { TeamCard } from "@/components/teams/team-card"
import { useFollows } from "@/components/teams/follows-provider"
import type { League, TeamView } from "@/lib/data/types"
import { groupByHierarchy } from "@/lib/hierarchy"
import { defaultTeamFilters, filterTeams, teamHierarchyRef } from "@/lib/teams"

type TeamsViewProps = {
  teams: TeamView[]
  leagues: League[]
}

const noun = { one: "team", other: "teams" }

/**
 * Every team across sports and esports: searched and filtered client-side,
 * then grouped along Category → Sport/Game → League so the collection scans
 * by domain without separating sports from esports.
 */
export function TeamsView({ teams, leagues }: TeamsViewProps) {
  const hierarchy = useHierarchyFilters(defaultTeamFilters, leagues)
  const { ids: followedIds } = useFollows()

  const visible = filterTeams(teams, hierarchy.filters)
  const grouped = groupByHierarchy(visible, teamHierarchyRef, hierarchy.filters)
  const followedCount = visible.filter((team) => followedIds.has(team.id)).length

  return (
    <CollectionBrowser
      idPrefix="teams"
      searchPlaceholder="Team name or abbreviation"
      hierarchy={hierarchy}
      grouped={grouped}
      followedCount={followedCount}
      noun={noun}
      itemKey={(team) => team.id}
      renderItem={(team) => <TeamCard team={team} showHierarchy={false} className="h-full" />}
      emptyTitle="No teams found"
    />
  )
}
