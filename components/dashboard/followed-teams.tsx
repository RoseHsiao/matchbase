import { UsersIcon } from "lucide-react"

import { SectionCard } from "@/components/layout/section-card"
import { EmptyState } from "@/components/empty-state"
import { TeamCard } from "@/components/teams/team-card"
import { getFollowedTeams } from "@/lib/data/queries"

export async function FollowedTeams({ now }: { now: Date }) {
  const teams = await getFollowedTeams(now)

  return (
    <SectionCard
      title="Followed teams"
      description={`${teams.length} ${teams.length === 1 ? "team" : "teams"}`}
      href="/teams"
    >
      {teams.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="You're not following any teams"
          description="Follow a team to see its fixtures here."
          className="mx-2"
        />
      ) : (
        <ul className="grid gap-0.5">
          {teams.map((team) => (
            <li key={team.id}>
              <TeamCard team={team} now={now} />
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}
