import { SectionCard } from "@/components/layout/section-card"
import { WatchlistMatches } from "@/components/watchlist/watchlist-matches"
import { getViewer } from "@/lib/auth/session"
import { getWatchlistMatches } from "@/lib/data/queries"

export async function WatchlistPreview({
  now,
  limit = 5,
}: {
  now: Date
  limit?: number
}) {
  const [viewer, matches] = await Promise.all([getViewer(), getWatchlistMatches()])

  return (
    <SectionCard
      title="Watchlist"
      description="Saved matches and their reminders"
      href={viewer ? "/watchlist" : undefined}
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
