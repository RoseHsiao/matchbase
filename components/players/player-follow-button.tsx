"use client"

import { FollowButton } from "@/components/follow-button"
import { usePlayerFollows } from "@/components/players/player-follows-provider"

type PlayerFollowButtonProps = {
  playerId: string
  playerName: string
  size?: "sm" | "default" | "lg"
  followedLabel?: "Following" | "Unfollow"
  className?: string
}

/** Follow or unfollow a player through the shared player-follows store. */
export function PlayerFollowButton({
  playerId,
  playerName,
  ...props
}: PlayerFollowButtonProps) {
  const { has, toggle } = usePlayerFollows()
  return (
    <FollowButton
      followed={has(playerId)}
      onToggle={() => toggle(playerId)}
      name={playerName}
      {...props}
    />
  )
}
