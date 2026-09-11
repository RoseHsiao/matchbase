"use client"

import { UsersIcon } from "lucide-react"

import { StatCard } from "@/components/dashboard/stat-card"
import { useFollows } from "@/components/teams/follows-provider"
import type { MatchView, TeamView } from "@/lib/data/types"
import { isSameDay } from "@/lib/format"

type FollowedTeamsStatCardProps = {
  teams: TeamView[]
  matches: MatchView[]
  /** Server reference time as ISO. */
  now: string
}

/** Dashboard stat tile for followed teams, driven by the shared store. */
export function FollowedTeamsStatCard({
  teams,
  matches,
  now: nowIso,
}: FollowedTeamsStatCardProps) {
  const { ids } = useFollows()
  const followed = teams.filter((team) => ids.has(team.id))
  const playingToday = followed.filter((team) =>
    matches.some(
      (match) =>
        isSameDay(match.startsAt, nowIso) &&
        (match.homeTeamId === team.id || match.awayTeamId === team.id)
    )
  ).length

  return (
    <StatCard
      label="Followed teams"
      value={followed.length}
      hint={playingToday > 0 ? `${playingToday} playing today` : "None playing today"}
      icon={UsersIcon}
      href="/teams"
    />
  )
}
