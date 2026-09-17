"use client"

import { CheckIcon, StarIcon } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { useWatchlist } from "@/components/watchlist/watchlist-provider"
import type { MatchStatus } from "@/lib/data/types"

type WatchlistButtonProps = {
  matchId: string
  status: MatchStatus
  className?: string
}

/**
 * Primary watchlist action for the match detail page: a pressed toggle that
 * reads "Add to Watchlist" and, once saved, "In Watchlist". Pressing it
 * again removes the match; the accessible description says so.
 */
export function WatchlistButton({ matchId, status, className }: WatchlistButtonProps) {
  const { has, toggle } = useWatchlist()
  const saved = has(matchId)
  const prominent = status === "upcoming" && !saved

  return (
    <Button
      type="button"
      variant={prominent ? "default" : "outline"}
      size="lg"
      aria-pressed={saved}
      title={saved ? "Remove from Watchlist" : undefined}
      className={cn("cursor-pointer", className)}
      onClick={() => toggle(matchId)}
    >
      {saved ? <CheckIcon data-icon="inline-start" /> : <StarIcon data-icon="inline-start" />}
      {saved ? "In Watchlist" : "Add to Watchlist"}
      {saved ? <span className="sr-only">. Press to remove from Watchlist.</span> : null}
    </Button>
  )
}
