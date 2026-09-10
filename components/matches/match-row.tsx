import { cn } from "cn"

import { ListRowLink } from "@/components/list-row-link"
import { MatchStatusBadge } from "@/components/matches/match-status-badge"
import { TeamLogo } from "@/components/matches/team-logo"
import type { MatchView, Team } from "@/lib/data/types"
import { formatDayLabel, formatTime } from "@/lib/format"

type MatchRowProps = {
  match: MatchView
  /** Reference time for "Today" / "Tomorrow" labels. */
  now?: Date
  showLeague?: boolean
  /** Hide the day label when every row in the list is on the same day. */
  showDay?: boolean
  /** Use the league's short name, for narrow columns. */
  compact?: boolean
  className?: string
}

/** One match in a list. Links to the match detail page. */
export function MatchRow({
  match,
  now = new Date(),
  showLeague = true,
  showDay = true,
  compact = false,
  className,
}: MatchRowProps) {
  const finished = match.status === "finished"
  const score = match.score
  const homeWon = finished && !!score && score.home > score.away
  const awayWon = finished && !!score && score.away > score.home

  return (
    <ListRowLink href={`/matches/${match.id}`} className={className}>
      <time
        dateTime={match.startsAt}
        className="block w-18 shrink-0 text-xs tabular-nums"
      >
        <span className="block font-medium">{formatTime(match.startsAt)}</span>
        {showDay ? (
          <span className="block text-muted-foreground">
            {formatDayLabel(match.startsAt, now)}
          </span>
        ) : null}
      </time>

      <div className="grid min-w-0 flex-1 gap-1 overflow-hidden">
        <TeamLine
          team={match.homeTeam}
          score={score?.home}
          emphasized={homeWon}
          muted={finished && awayWon}
        />
        <TeamLine
          team={match.awayTeam}
          score={score?.away}
          emphasized={awayWon}
          muted={finished && homeWon}
        />
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1 text-right">
        <MatchStatusBadge status={match.status} liveDetail={match.liveDetail} />
        {showLeague ? (
          <span
            className="hidden max-w-36 truncate text-xs text-muted-foreground sm:block"
            title={match.league.name}
          >
            {compact ? match.league.shortName : match.league.name}
          </span>
        ) : null}
      </div>
    </ListRowLink>
  )
}

function TeamLine({
  team,
  score,
  emphasized,
  muted,
}: {
  team: Team
  score?: number
  emphasized?: boolean
  muted?: boolean
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 text-sm",
        muted && "text-muted-foreground"
      )}
    >
      <TeamLogo team={team} size="sm" />
      <span className={cn("truncate", emphasized && "font-semibold")}>
        {team.name}
      </span>
      {score !== undefined ? (
        <span
          className={cn(
            "ml-auto pl-2 tabular-nums",
            emphasized && "font-semibold"
          )}
        >
          {score}
        </span>
      ) : null}
    </div>
  )
}
