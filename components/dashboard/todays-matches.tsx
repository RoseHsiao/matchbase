import Link from "next/link"

import { SectionCard } from "@/components/layout/section-card"
import { MatchList } from "@/components/matches/match-list"
import { buttonVariants } from "@/components/ui/button"
import { ReminderBadge } from "@/components/watchlist/reminder-badge"
import { WatchlistToggle } from "@/components/watchlist/watchlist-toggle"
import type { MatchView } from "@/lib/data/types"

/**
 * The strongest section on the dashboard: every match today that involves
 * something the user follows, live first. Each row carries sport, league,
 * time, participants, status, score, and, through the shared stores, the
 * watchlist star and the reminder state.
 */
export function TodaysMatches({ matches, now }: { matches: MatchView[]; now: Date }) {
  const live = matches.filter((match) => match.status === "live").length
  const finished = matches.filter((match) => match.status === "finished").length
  const upcoming = matches.length - live - finished
  const description =
    matches.length === 0
      ? "Nothing today for the teams, players and leagues you follow."
      : [
          live > 0 ? `${live} live now` : null,
          upcoming > 0 ? `${upcoming} still to play` : null,
          finished > 0 ? `${finished} finished` : null,
        ]
          .filter(Boolean)
          .join(" · ")

  return (
    <SectionCard
      title="Today's matches"
      description={description}
      href="/schedule"
      actionLabel="Schedule"
    >
      <MatchList
        matches={matches}
        now={now}
        showDay={false}
        groupByStatus
        renderMeta={(match) => <ReminderBadge match={match} />}
        renderAction={(match) => <WatchlistToggle matchId={match.id} />}
        emptyTitle="No matches today"
        emptyDescription="Follow more teams and players, or browse the schedule to find something to watch."
        emptyAction={
          <span className="flex flex-wrap justify-center gap-2">
            <Link href="/schedule" className={buttonVariants({ variant: "default", size: "sm" })}>
              Browse the schedule
            </Link>
            <Link href="/teams" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Follow teams
            </Link>
          </span>
        }
      />
    </SectionCard>
  )
}
