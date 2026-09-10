import { SectionCard } from "@/components/layout/section-card"
import { MatchList } from "@/components/matches/match-list"
import { getTodaysMatches } from "@/lib/data/queries"

export async function TodaysMatches({ now }: { now: Date }) {
  const matches = await getTodaysMatches(now)
  const live = matches.filter((match) => match.status === "live").length
  const description =
    matches.length === 0
      ? "Nothing scheduled for the teams and leagues you follow."
      : `${matches.length} ${matches.length === 1 ? "match" : "matches"}${
          live > 0 ? ` · ${live} live` : ""
        }`

  return (
    <SectionCard
      title="Today's matches"
      description={description}
      href="/matches"
      actionLabel="All matches"
    >
      <MatchList
        matches={matches}
        now={now}
        showDay={false}
        groupByStatus
        emptyTitle="No matches today"
        emptyDescription="Follow more teams or leagues to fill up your day."
      />
    </SectionCard>
  )
}
