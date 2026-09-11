import Link from "next/link"
import { MapPinIcon } from "lucide-react"
import { cn } from "cn"

import { MatchStatusBadge } from "@/components/matches/match-status-badge"
import { TeamLogo } from "@/components/matches/team-logo"
import { Card, CardContent } from "@/components/ui/card"
import type { MatchView, Team } from "@/lib/data/types"
import { formatDayLabel, formatKickoff, formatTime } from "@/lib/format"
import { sportLabel } from "@/lib/sports"

type MatchScoreboardProps = {
  match: MatchView
  now?: Date
  className?: string
}

/** Hero panel for the match detail page. Adapts to upcoming, live, and finished. */
export function MatchScoreboard({ match, now, className }: MatchScoreboardProps) {
  const { status, score } = match
  const finished = status === "finished"
  const live = status === "live"
  const homeWon = finished && !!score && score.home > score.away
  const awayWon = finished && !!score && score.away > score.home

  return (
    <Card className={cn(live && "ring-red-500/30", className)}>
      <CardContent className="grid gap-6 py-2">
        <div className="flex flex-wrap items-center justify-center gap-x-2 text-center text-sm text-muted-foreground">
          <span>{sportLabel(match.league.sport)}</span>
          <span aria-hidden>·</span>
          <span>{match.league.name}</span>
          {match.stage ? (
            <>
              <span aria-hidden>·</span>
              <span>{match.stage}</span>
            </>
          ) : null}
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-6">
          <TeamBlock
            team={match.homeTeam}
            role="Home"
            emphasized={homeWon}
            muted={finished && awayWon}
          />

          <div className="grid justify-items-center gap-2">
            {score ? (
              <div className="flex items-baseline gap-2 text-4xl font-semibold tabular-nums sm:gap-3 sm:text-5xl">
                <span className={cn(finished && awayWon && "text-muted-foreground")}>
                  {score.home}
                </span>
                <span className="text-2xl text-muted-foreground sm:text-3xl">–</span>
                <span className={cn(finished && homeWon && "text-muted-foreground")}>
                  {score.away}
                </span>
              </div>
            ) : (
              <time
                dateTime={match.startsAt}
                className="grid justify-items-center leading-tight"
              >
                <span className="text-3xl font-semibold tabular-nums sm:text-4xl">
                  {formatTime(match.startsAt)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {formatDayLabel(match.startsAt, now)}
                </span>
              </time>
            )}
            <MatchStatusBadge status={status} liveDetail={match.liveDetail} />
          </div>

          <TeamBlock
            team={match.awayTeam}
            role="Away"
            emphasized={awayWon}
            muted={finished && homeWon}
          />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <time dateTime={match.startsAt} className="tabular-nums">
            {formatKickoff(match.startsAt, now)}
          </time>
          {match.venue ? (
            <span className="inline-flex items-center gap-1">
              <MapPinIcon className="size-3.5" aria-hidden />
              {match.venue}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function TeamBlock({
  team,
  role,
  emphasized,
  muted,
}: {
  team: Team
  role: "Home" | "Away"
  emphasized?: boolean
  muted?: boolean
}) {
  return (
    <Link
      href={`/teams/${team.id}`}
      className={cn(
        "grid min-w-0 justify-items-center gap-2 rounded-lg p-2 text-center outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50",
        muted && "text-muted-foreground"
      )}
    >
      <TeamLogo team={team} size="xl" />
      <span className="grid min-w-0 justify-items-center leading-tight">
        <span
          className={cn(
            "max-w-full truncate text-sm sm:text-lg",
            emphasized ? "font-semibold" : "font-medium"
          )}
        >
          {team.name}
        </span>
        <span className="text-xs text-muted-foreground">
          {team.code} · {role}
        </span>
      </span>
    </Link>
  )
}
