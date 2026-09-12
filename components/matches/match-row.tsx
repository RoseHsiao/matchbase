import Link from "next/link"
import { cn } from "cn"

import { MatchStatusBadge } from "@/components/matches/match-status-badge"
import { TeamLogo } from "@/components/matches/team-logo"
import type { MatchView, Team } from "@/lib/data/types"
import { formatDayLabel, formatTime } from "@/lib/format"
import { hierarchyLabel, sportLabel } from "@/lib/sports"

type MatchRowProps = {
  match: MatchView
  /** Reference time for "Today" / "Tomorrow" labels. */
  now?: Date
  showLeague?: boolean
  /** Hide the day label when every row in the list is on the same day. */
  showDay?: boolean
  /** Use the league's short name, for narrow columns. */
  compact?: boolean
  /** Control rendered beside the row, outside the link (e.g. a watchlist star). */
  action?: React.ReactNode
  className?: string
}

/**
 * One match in a list. The row links to the match page; the league label is a
 * separate link to the league page, and `action` renders a control beside it.
 * The match link is "stretched" over the row so the whole row stays clickable
 * without nesting anchors.
 */
export function MatchRow({
  match,
  now = new Date(),
  showLeague = true,
  showDay = true,
  compact = false,
  action,
  className,
}: MatchRowProps) {
  const finished = match.status === "finished"
  const score = match.score
  const homeWon = finished && !!score && score.home > score.away
  const awayWon = finished && !!score && score.away > score.home

  return (
    <div
      className={cn(
        "relative flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/60 has-[[data-row-link]:focus-visible]:ring-2 has-[[data-row-link]:focus-visible]:ring-ring/50",
        className
      )}
    >
      <Link
        href={`/matches/${match.id}`}
        data-row-link
        className="flex min-w-0 flex-1 items-center gap-3 outline-none after:absolute after:inset-0 after:z-[1] after:rounded-lg"
      >
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
      </Link>

      <div className="flex shrink-0 flex-col items-end gap-1 text-right">
        <MatchStatusBadge status={match.status} liveDetail={match.liveDetail} />
        {showLeague ? (
          <Link
            href={`/leagues/${match.league.id}`}
            className="relative z-[2] hidden max-w-40 truncate rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 sm:block"
            title={hierarchyLabel(match.league.sport, match.league.name)}
          >
            {compact
              ? match.league.shortName
              : `${sportLabel(match.league.sport)} · ${match.league.shortName}`}
          </Link>
        ) : null}
      </div>

      {action ? <div className="relative z-[2] shrink-0">{action}</div> : null}
    </div>
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
