import { SectionCard } from "@/components/layout/section-card"
import { WatchlistMatches } from "@/components/watchlist/watchlist-matches"
import { getMatches } from "@/lib/data/queries"

export async function WatchlistPreview({
  now,
  limit = 5,
}: {
  now: Date
  limit?: number
}) {
  const matches = await getMatches()

  return (
    <SectionCard
      title="Watchlist"
      description="Matches you've saved to watch"
      href="/watchlist"
    >
      <WatchlistMatches
        matches={matches}
        now={now.toISOString()}
        limit={limit}
        compact
      />
    </SectionCard>
  )
}
