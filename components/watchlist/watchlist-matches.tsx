"use client"

import Link from "next/link"
import { StarIcon } from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { MatchList } from "@/components/matches/match-list"
import { buttonVariants } from "@/components/ui/button"
import { ReminderBadge } from "@/components/watchlist/reminder-badge"
import { useWatchlist } from "@/components/watchlist/watchlist-provider"
import { WatchlistToggle } from "@/components/watchlist/watchlist-toggle"
import type { MatchView } from "@/lib/data/types"
import { selectWatchlistMatches } from "@/lib/watchlist/select"

type WatchlistMatchesProps = {
  /** Candidate matches; only saved ones are shown. */
  matches: MatchView[]
  /** Server reference time as ISO, for "Today" labels. */
  now: string
  limit?: number
  compact?: boolean
}

/** Dashboard panel body: saved matches, live first, with a remove control. */
export function WatchlistMatches({
  matches,
  now: nowIso,
  limit,
  compact = false,
}: WatchlistMatchesProps) {
  const { ids } = useWatchlist()
  const saved = selectWatchlistMatches(matches, ids, "status", limit)

  if (saved.length === 0) {
    return (
      <EmptyState
        icon={StarIcon}
        title="Your watchlist is empty"
        description="Save matches from the Schedule or a match page."
        action={
          <Link
            href="/schedule"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Browse schedule
          </Link>
        }
        className="mx-2"
      />
    )
  }

  return (
    <MatchList
      matches={saved}
      now={new Date(nowIso)}
      compact={compact}
      renderMeta={(match) => <ReminderBadge match={match} showTime={!compact} />}
      renderAction={(match) => <WatchlistToggle matchId={match.id} />}
    />
  )
}
