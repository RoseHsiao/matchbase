"use client"

import Link from "next/link"
import { StarIcon } from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { MatchDayList } from "@/components/matches/match-day-list"
import { buttonVariants } from "@/components/ui/button"
import { useWatchlist } from "@/components/watchlist/watchlist-provider"
import { WatchlistToggle } from "@/components/watchlist/watchlist-toggle"
import type { MatchView } from "@/lib/data/types"
import { groupMatchesByDay } from "@/lib/schedule"
import { selectWatchlistMatches } from "@/lib/watchlist/select"

type WatchlistViewProps = {
  /** Candidate matches; only saved ones are shown. */
  matches: MatchView[]
  /** Server reference time as ISO, for "Today" labels. */
  now: string
}

/** Watchlist page body: saved matches grouped by day, each removable. */
export function WatchlistView({ matches, now: nowIso }: WatchlistViewProps) {
  const now = new Date(nowIso)
  const { ids } = useWatchlist()
  const saved = selectWatchlistMatches(matches, ids)
  const live = saved.filter((match) => match.status === "live").length

  if (saved.length === 0) {
    return (
      <EmptyState
        icon={StarIcon}
        title="Your watchlist is empty"
        description="Save a match from the Schedule or from any match page and it will show up here."
        action={
          <Link href="/schedule" className={buttonVariants({ variant: "default" })}>
            Browse the schedule
          </Link>
        }
        className="py-16"
      />
    )
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {saved.length} saved {saved.length === 1 ? "match" : "matches"}
        {live > 0 ? ` · ${live} live now` : ""}
      </p>
      <MatchDayList
        groups={groupMatchesByDay(saved)}
        now={now}
        renderAction={(match) => <WatchlistToggle matchId={match.id} />}
      />
    </div>
  )
}
