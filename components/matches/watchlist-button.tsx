"use client"

import * as React from "react"
import { StarIcon } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import type { MatchStatus } from "@/lib/data/types"

type WatchlistButtonProps = {
  matchId: string
  initialWatchlisted: boolean
  status: MatchStatus
  className?: string
}

/**
 * Toggles a match on the user's watchlist. Local state only until a
 * persistence layer exists; `matchId` is kept so the action can be wired up.
 */
export function WatchlistButton({
  matchId,
  initialWatchlisted,
  status,
  className,
}: WatchlistButtonProps) {
  const [watchlisted, setWatchlisted] = React.useState(initialWatchlisted)
  const prominent = status === "upcoming" && !watchlisted

  return (
    <Button
      type="button"
      variant={prominent ? "default" : "outline"}
      size="lg"
      aria-pressed={watchlisted}
      data-match-id={matchId}
      className={cn("cursor-pointer", className)}
      onClick={() => setWatchlisted((value) => !value)}
    >
      <StarIcon
        data-icon="inline-start"
        className={cn(watchlisted && "fill-current")}
      />
      {watchlisted ? "On your watchlist" : "Add to watchlist"}
    </Button>
  )
}
