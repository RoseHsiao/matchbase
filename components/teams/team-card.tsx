import Link from "next/link"
import { cn } from "cn"

import { TeamLogo } from "@/components/matches/team-logo"
import { TeamFollowButton } from "@/components/teams/follow-button"
import { Card, CardContent } from "@/components/ui/card"
import type { TeamView } from "@/lib/data/types"
import { sportLabel } from "@/lib/sports"

type TeamCardProps = {
  team: TeamView
  className?: string
}

/**
 * Grid card for browsing teams. The name links to the team page; the follow
 * button is a separate control, so the card itself is not clickable.
 */
export function TeamCard({ team, className }: TeamCardProps) {
  return (
    <Card size="sm" className={cn("min-w-0", className)}>
      <CardContent className="flex items-start gap-3">
        <Link
          href={`/teams/${team.id}`}
          aria-label={team.name}
          className="shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <TeamLogo team={team} size="lg" />
        </Link>

        <div className="grid min-w-0 flex-1 gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href={`/teams/${team.id}`}
              className="min-w-0 truncate text-sm font-semibold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {team.name}
            </Link>
            <span className="shrink-0 text-xs text-muted-foreground">{team.code}</span>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {sportLabel(team.league.sport)} · {team.league.name}
          </div>
          <div className="mt-1">
            <TeamFollowButton teamId={team.id} teamName={team.name} size="sm" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
