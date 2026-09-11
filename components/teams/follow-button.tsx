"use client"

import { CheckIcon, PlusIcon } from "lucide-react"
import { cn } from "cn"

import { useFollows } from "@/components/teams/follows-provider"
import { Button } from "@/components/ui/button"

type FollowButtonProps = {
  teamId: string
  /** Accessible team name for the button label. */
  teamName: string
  size?: "sm" | "default" | "lg"
  /** Text shown while following. "Following" for lists, "Unfollow" for detail pages. */
  followedLabel?: "Following" | "Unfollow"
  className?: string
}

/** Follow or unfollow a team. Reads and writes the shared follows store. */
export function FollowButton({
  teamId,
  teamName,
  size = "sm",
  followedLabel = "Following",
  className,
}: FollowButtonProps) {
  const { has, toggle } = useFollows()
  const followed = has(teamId)

  return (
    <Button
      type="button"
      variant={followed ? "outline" : "default"}
      size={size}
      aria-pressed={followed}
      aria-label={followed ? `Unfollow ${teamName}` : `Follow ${teamName}`}
      className={cn("cursor-pointer", className)}
      onClick={() => toggle(teamId)}
    >
      {followed ? (
        <CheckIcon data-icon="inline-start" />
      ) : (
        <PlusIcon data-icon="inline-start" />
      )}
      {followed ? followedLabel : "Follow"}
    </Button>
  )
}
