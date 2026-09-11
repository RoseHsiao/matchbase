import { SectionCard } from "@/components/layout/section-card"
import { FollowedTeamList } from "@/components/teams/followed-team-list"
import { getTeamViews } from "@/lib/data/queries"

export async function FollowedTeams({ now }: { now: Date }) {
  const teams = await getTeamViews(now)

  return (
    <SectionCard
      title="Followed teams"
      description="Teams you follow and their next fixture"
      href="/teams"
    >
      <FollowedTeamList teams={teams} now={now.toISOString()} />
    </SectionCard>
  )
}
