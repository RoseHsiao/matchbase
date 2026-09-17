"use client"

import { StarIcon } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { useWatchlist } from "@/components/watchlist/watchlist-provider"

type WatchlistToggleProps = {
  matchId: string
  className?: string
}

/** Compact star button for list rows. Filled when the match is saved. */
export function WatchlistToggle({ matchId, className }: WatchlistToggleProps) {
  const { has, toggle } = useWatchlist()
  const saved = has(matchId)
  const label = saved ? "Remove from Watchlist" : "Add to Watchlist"

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-pressed={saved}
      aria-label={label}
      title={label}
      className={cn(
        "shrink-0 cursor-pointer",
        saved ? "text-foreground" : "text-muted-foreground",
        className
      )}
      onClick={() => toggle(matchId)}
    >
      <StarIcon className={cn(saved && "fill-current")} />
    </Button>
  )
}
