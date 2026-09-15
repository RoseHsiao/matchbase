"use client"

import Link from "next/link"
import { StarIcon } from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { MatchDayList } from "@/components/matches/match-day-list"
import { buttonVariants } from "@/components/ui/button"
import { ReminderSelect } from "@/components/watchlist/reminder-select"
import { useWatchlist } from "@/components/watchlist/watchlist-provider"
import { useWatchlistReminders } from "@/components/watchlist/watchlist-reminders-provider"
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
  const { entries: reminders } = useWatchlistReminders()
  const saved = selectWatchlistMatches(matches, ids)
  const live = saved.filter((match) => match.status === "live").length
  const withReminder = saved.filter((match) => match.status === "upcoming" && (reminders.get(match.id)?.reminder ?? "off") !== "off").length

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
        {withReminder > 0 ? ` · ${withReminder} with a reminder` : ""}
      </p>
      <MatchDayList
        groups={groupMatchesByDay(saved)}
        now={now}
        renderAction={(match) => (
          // Phones stack the two controls so the team names keep their width.
          <div className="flex flex-col-reverse items-end gap-1 sm:flex-row sm:items-center">
            {match.status === "upcoming" ? <ReminderSelect match={match} now={now} compact /> : null}
            <WatchlistToggle matchId={match.id} />
          </div>
        )}
      />
    </div>
  )
}
