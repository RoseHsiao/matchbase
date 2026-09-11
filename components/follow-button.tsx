"use client"

import { CheckIcon, PlusIcon } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"

type FollowButtonProps = {
  followed: boolean
  onToggle: () => void
  /** Accessible name of the thing being followed, e.g. a team or player. */
  name: string
  size?: "sm" | "default" | "lg"
  /** Text shown while following. "Following" for lists, "Unfollow" for detail pages. */
  followedLabel?: "Following" | "Unfollow"
  className?: string
}

/** Presentational follow toggle. Feature wrappers bind it to a store. */
export function FollowButton({
  followed,
  onToggle,
  name,
  size = "sm",
  followedLabel = "Following",
  className,
}: FollowButtonProps) {
  return (
    <Button
      type="button"
      variant={followed ? "outline" : "default"}
      size={size}
      aria-pressed={followed}
      aria-label={followed ? `Unfollow ${name}` : `Follow ${name}`}
      className={cn("cursor-pointer", className)}
      onClick={onToggle}
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
