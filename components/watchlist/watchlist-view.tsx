"use client"

import Link from "next/link"
import { BellRingIcon, StarIcon } from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { MatchDayList } from "@/components/matches/match-day-list"
import { buttonVariants } from "@/components/ui/button"
import { ReminderSelect } from "@/components/watchlist/reminder-select"
import { useWatchlist } from "@/components/watchlist/watchlist-provider"
import { useWatchlistReminders } from "@/components/watchlist/watchlist-reminders-provider"
import { WatchlistToggle } from "@/components/watchlist/watchlist-toggle"
import type { MatchView } from "@/lib/data/types"
import { isReminderAvailable } from "@/lib/reminders"
import { groupMatchesByDay } from "@/lib/schedule"
import { selectWatchlistMatches } from "@/lib/watchlist/select"

type WatchlistViewProps = {
  /** Candidate matches; only saved ones are shown. */
  matches: MatchView[]
  /** Server reference time as ISO, for "Today" labels. */
  now: string
}

/**
 * Watchlist page body. Answers three questions in order: what is saved, what
 * is still to come (with its reminder, editable in place), and what has
 * finished (kept as history, without reminder controls).
 */
export function WatchlistView({ matches, now: nowIso }: WatchlistViewProps) {
  const now = new Date(nowIso)
  const { ids } = useWatchlist()
  const { entries: reminders } = useWatchlistReminders()
  const saved = selectWatchlistMatches(matches, ids)
  const live = saved.filter((match) => match.status === "live").length
  const upcoming = saved.filter((match) => isReminderAvailable(match.status))
  const finished = saved.filter((match) => match.status === "finished")
  const stillToCome = saved.filter((match) => match.status !== "finished")
  const withReminder = upcoming.filter((match) => (reminders.get(match.id)?.reminder ?? "off") !== "off").length

  if (saved.length === 0) {
    return (
      <EmptyState
        icon={StarIcon}
        title="Your watchlist is empty"
        description="Add a match from the Schedule or any match page, then choose when to be reminded."
        action={
          <Link href="/schedule" className={buttonVariants({ variant: "default" })}>
            Browse the schedule
          </Link>
        }
        className="py-16"
      />
    )
  }

  const renderAction = (match: MatchView) => (
    // Phones stack the two controls so the team names keep their width.
    <div className="flex flex-col-reverse items-end gap-1 sm:flex-row sm:items-center">
      {match.status === "upcoming" ? <ReminderSelect match={match} now={now} compact /> : null}
      <WatchlistToggle matchId={match.id} />
    </div>
  )

  return (
    <div className="grid gap-6">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {saved.length} saved {saved.length === 1 ? "match" : "matches"}
        {` · ${upcoming.length} upcoming`}
        {live > 0 ? ` · ${live} live now` : ""}
        {` · ${withReminder} with a reminder`}
      </p>

      <section aria-labelledby="watchlist-upcoming" className="grid gap-3">
        <h2 id="watchlist-upcoming" className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold">
          Still to come
          <span className="text-xs font-normal text-muted-foreground">
            {upcoming.length === 0
              ? "Nothing upcoming"
              : `${upcoming.length} ${upcoming.length === 1 ? "match" : "matches"} · ${withReminder} with a reminder`}
          </span>
        </h2>
        {stillToCome.length === 0 ? (
          <EmptyState
            icon={BellRingIcon}
            title="No upcoming matches on your Watchlist"
            description="Save an upcoming match to choose when to be reminded."
            action={
              <Link href="/schedule" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Browse the schedule
              </Link>
            }
          />
        ) : (
          <MatchDayList groups={groupMatchesByDay(stillToCome)} now={now} renderAction={renderAction} headingTag="h3" />
        )}
      </section>

      {finished.length > 0 ? (
        <section aria-labelledby="watchlist-finished" className="grid gap-3">
          <h2 id="watchlist-finished" className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold">
            Finished
            <span className="text-xs font-normal text-muted-foreground">
              {finished.length} {finished.length === 1 ? "match" : "matches"} · kept for reference, no reminders
            </span>
          </h2>
          <MatchDayList groups={groupMatchesByDay(finished)} now={now} renderAction={renderAction} headingTag="h3" />
        </section>
      ) : null}
    </div>
  )
}
