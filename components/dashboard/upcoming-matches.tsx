import Link from "next/link"

import { SectionCard } from "@/components/layout/section-card"
import { MatchList } from "@/components/matches/match-list"
import { buttonVariants } from "@/components/ui/button"
import { WatchlistToggle } from "@/components/watchlist/watchlist-toggle"
import { getUpcomingFollowedMatches } from "@/lib/data/queries"

/** Secondary discovery: the next fixtures after today for followed teams and players, each saveable in place. */
export async function UpcomingMatches({ now, limit = 5 }: { now: Date; limit?: number }) {
  const matches = await getUpcomingFollowedMatches(limit, now)

  return (
    <SectionCard
      title="Coming up"
      description="Next fixtures for the teams and players you follow. Star one to save it."
      href="/schedule"
      actionLabel="Full schedule"
    >
      <MatchList
        matches={matches}
        now={now}
        compact
        renderAction={(match) => <WatchlistToggle matchId={match.id} />}
        emptyTitle="No upcoming fixtures"
        emptyDescription="Nothing is scheduled after today for what you follow."
        emptyAction={
          <Link href="/matches" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Browse all matches
          </Link>
        }
      />
    </SectionCard>
  )
}
