import { SectionCard } from "@/components/layout/section-card"
import { MatchList } from "@/components/matches/match-list"
import { getUpcomingFollowedMatches } from "@/lib/data/queries"

export async function UpcomingMatches({
  now,
  limit = 5,
}: {
  now: Date
  limit?: number
}) {
  const matches = await getUpcomingFollowedMatches(limit, now)

  return (
    <SectionCard
      title="Upcoming matches"
      description="Next fixtures for the teams you follow"
      href="/schedule"
    >
      <MatchList
        matches={matches}
        now={now}
        emptyTitle="No upcoming fixtures"
        emptyDescription="Your followed teams have nothing scheduled yet."
      />
    </SectionCard>
  )
}
