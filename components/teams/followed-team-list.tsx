"use client"

import Link from "next/link"
import { UsersIcon } from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { useFollows } from "@/components/teams/follows-provider"
import { TeamRow } from "@/components/teams/team-row"
import { buttonVariants } from "@/components/ui/button"
import type { TeamView } from "@/lib/data/types"

type FollowedTeamListProps = {
  /** Candidate teams; only followed ones are shown. */
  teams: TeamView[]
  /** Server reference time as ISO, for "Today" labels. */
  now: string
}

/** Dashboard panel body: followed teams with their next fixture. */
export function FollowedTeamList({ teams, now: nowIso }: FollowedTeamListProps) {
  const { ids } = useFollows()
  const followed = teams.filter((team) => ids.has(team.id))
  const now = new Date(nowIso)

  if (followed.length === 0) {
    return (
      <EmptyState
        icon={UsersIcon}
        title="You're not following any teams"
        description="Follow a team to see its fixtures here."
        action={
          <Link
            href="/teams"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Browse teams
          </Link>
        }
        className="mx-2"
      />
    )
  }

  return (
    <ul className="grid gap-0.5">
      {followed.map((team) => (
        <li key={team.id}>
          <TeamRow team={team} now={now} />
        </li>
      ))}
    </ul>
  )
}
