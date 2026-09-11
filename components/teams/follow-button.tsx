"use client"

import { FollowButton } from "@/components/follow-button"
import { useFollows } from "@/components/teams/follows-provider"

type TeamFollowButtonProps = {
  teamId: string
  teamName: string
  size?: "sm" | "default" | "lg"
  followedLabel?: "Following" | "Unfollow"
  className?: string
}

/** Follow or unfollow a team through the shared team-follows store. */
export function TeamFollowButton({
  teamId,
  teamName,
  ...props
}: TeamFollowButtonProps) {
  const { has, toggle } = useFollows()
  return (
    <FollowButton
      followed={has(teamId)}
      onToggle={() => toggle(teamId)}
      name={teamName}
      {...props}
    />
  )
}
