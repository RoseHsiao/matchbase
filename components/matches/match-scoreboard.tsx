import Link from "next/link"
import { MapPinIcon } from "lucide-react"

import { MatchStatusBadge } from "@/components/matches/match-status-badge"
import { TeamLogo } from "@/components/matches/team-logo"
import { Card, CardContent } from "@/components/ui/card"
import type { MatchView, Team } from "@/lib/data/types"
import { formatKickoff } from "@/lib/format"

/** Hero panel for the match detail page. */
export function MatchScoreboard({ match, now }: { match: MatchView; now?: Date }) {
  const score = match.score
  const centre =
    score !== undefined ? (
      <div className="text-3xl font-semibold tabular-nums sm:text-4xl">
        {score.home}
        <span className="mx-2 text-muted-foreground">–</span>
        {score.away}
      </div>
    ) : (
      <div className="text-2xl font-semibold text-muted-foreground">vs</div>
    )

  return (
    <Card>
      <CardContent className="grid gap-6">
        <div className="flex flex-wrap items-center justify-center gap-2 text-center text-sm text-muted-foreground">
          <span>{match.league.name}</span>
          {match.stage ? (
            <>
              <span aria-hidden>·</span>
              <span>{match.stage}</span>
            </>
          ) : null}
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <TeamBlock team={match.homeTeam} />
          <div className="grid justify-items-center gap-2">
            {centre}
            <MatchStatusBadge status={match.status} liveDetail={match.liveDetail} />
          </div>
          <TeamBlock team={match.awayTeam} />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="tabular-nums">{formatKickoff(match.startsAt, now)}</span>
          {match.venue ? (
            <span className="inline-flex items-center gap-1">
              <MapPinIcon className="size-3.5" />
              {match.venue}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function TeamBlock({ team }: { team: Team }) {
  return (
    <Link
      href={`/teams/${team.id}`}
      className="grid justify-items-center gap-2 rounded-lg p-2 text-center outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <TeamLogo team={team} size="xl" />
      <span className="text-sm font-medium sm:text-base">{team.name}</span>
    </Link>
  )
}
