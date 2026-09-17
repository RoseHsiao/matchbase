"use client"

import Link from "next/link"
import { StarIcon } from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { MatchList } from "@/components/matches/match-list"
import { buttonVariants } from "@/components/ui/button"
import { ReminderBadge } from "@/components/watchlist/reminder-badge"
import { useWatchlist } from "@/components/watchlist/watchlist-provider"
import { useWatchlistReminders } from "@/components/watchlist/watchlist-reminders-provider"
import { WatchlistToggle } from "@/components/watchlist/watchlist-toggle"
import type { MatchView } from "@/lib/data/types"
import { isReminderAvailable } from "@/lib/reminders"
import { selectWatchlistMatches } from "@/lib/watchlist/select"

type WatchlistMatchesProps = {
  /** Candidate matches; only saved ones are shown. */
  matches: MatchView[]
  /** Server reference time as ISO, for "Today" labels. */
  now: string
  limit?: number
  compact?: boolean
}

/**
 * Dashboard panel body: saved matches, live first, then upcoming, with the
 * reminder state spelled out on every upcoming row ("15 min before" or
 * "No reminder") so the two are told apart by text and icon, not colour.
 */
export function WatchlistMatches({ matches, now: nowIso, limit, compact = false }: WatchlistMatchesProps) {
  const { ids } = useWatchlist()
  const { entries } = useWatchlistReminders()
  const saved = selectWatchlistMatches(matches, ids, "status")
  const upcoming = saved.filter((match) => isReminderAvailable(match.status))
  const withReminder = upcoming.filter((match) => (entries.get(match.id)?.reminder ?? "off") !== "off").length
  const shown = limit === undefined ? saved : saved.slice(0, limit)

  if (saved.length === 0) {
    return (
      <EmptyState
        icon={StarIcon}
        title="Your watchlist is empty"
        description="Star a match anywhere to add it to your Watchlist, then choose when to be reminded."
        action={
          <Link href="/schedule" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Browse the schedule
          </Link>
        }
        className="mx-2"
      />
    )
  }

  return (
    <div className="grid gap-2">
      <p className="px-3 text-xs text-muted-foreground" aria-live="polite">
        {saved.length} saved · {upcoming.length} upcoming · {withReminder} with a reminder
      </p>
      <MatchList
        matches={shown}
        now={new Date(nowIso)}
        compact={compact}
        renderMeta={(match) => <ReminderBadge match={match} showOff />}
        renderAction={(match) => <WatchlistToggle matchId={match.id} />}
      />
      {shown.length < saved.length ? (
        <p className="px-3 text-xs text-muted-foreground">
          <Link href="/watchlist" className="rounded-sm outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">
            {saved.length - shown.length} more on your watchlist
          </Link>
        </p>
      ) : null}
    </div>
  )
}
