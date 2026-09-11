"use client"

import { UserRoundIcon } from "lucide-react"

import { StatCard } from "@/components/dashboard/stat-card"
import { usePlayerFollows } from "@/components/players/player-follows-provider"
import type { PlayerView } from "@/lib/data/types"

/** Dashboard stat tile for followed players, driven by the shared store. */
export function FollowedPlayersStatCard({ players }: { players: PlayerView[] }) {
  const { ids } = usePlayerFollows()
  const followed = players.filter((player) => ids.has(player.id))
  const teamCount = new Set(followed.map((player) => player.teamId)).size

  return (
    <StatCard
      label="Followed players"
      value={followed.length}
      hint={
        teamCount > 0
          ? `Across ${teamCount} ${teamCount === 1 ? "team" : "teams"}`
          : "Follow players to track them here"
      }
      icon={UserRoundIcon}
      href="/players"
    />
  )
}
