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
      description="Saved matches and their reminders"
      href="/watchlist"
      actionLabel="Manage"
    >
      <WatchlistMatches
        matches={matches}
        now={now.toISOString()}
        limit={limit}
      />
    </SectionCard>
  )
}
