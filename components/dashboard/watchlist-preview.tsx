import { SectionCard } from "@/components/layout/section-card"
import { MatchList } from "@/components/matches/match-list"
import { getWatchlistMatches } from "@/lib/data/queries"

export async function WatchlistPreview({
  now,
  limit = 5,
}: {
  now: Date
  limit?: number
}) {
  const matches = await getWatchlistMatches(limit)

  return (
    <SectionCard
      title="Watchlist"
      description="Matches you've saved to watch"
      href="/watchlist"
    >
      <MatchList
        matches={matches}
        now={now}
        compact
        emptyTitle="Your watchlist is empty"
        emptyDescription="Add matches from the schedule to keep track of them here."
      />
    </SectionCard>
  )
}
