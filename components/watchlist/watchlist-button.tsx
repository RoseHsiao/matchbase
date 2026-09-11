"use client"

import { StarIcon } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { useWatchlist } from "@/components/watchlist/watchlist-provider"
import type { MatchStatus } from "@/lib/data/types"

type WatchlistButtonProps = {
  matchId: string
  status: MatchStatus
  className?: string
}

/** Primary watchlist action for the match detail page. */
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
      className={cn("cursor-pointer", className)}
      onClick={() => toggle(matchId)}
    >
      <StarIcon data-icon="inline-start" className={cn(saved && "fill-current")} />
      {saved ? "Remove from Watchlist" : "Add to Watchlist"}
    </Button>
  )
}
