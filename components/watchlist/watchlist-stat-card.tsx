"use client"

import { StarIcon } from "lucide-react"

import { StatCard } from "@/components/dashboard/stat-card"
import { useWatchlist } from "@/components/watchlist/watchlist-provider"
import type { MatchView } from "@/lib/data/types"
import { selectWatchlistMatches } from "@/lib/watchlist/select"

/** Dashboard stat tile for the watchlist, driven by the shared store. */
export function WatchlistStatCard({ matches }: { matches: MatchView[] }) {
  const { ids } = useWatchlist()
  const saved = selectWatchlistMatches(matches, ids)
  const live = saved.filter((match) => match.status === "live").length

  return (
    <StatCard
      label="Watchlist matches"
      value={saved.length}
      hint={live > 0 ? `${live} live right now` : "None live right now"}
      icon={StarIcon}
      href="/watchlist"
    />
  )
}
