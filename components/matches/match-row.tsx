import Link from "next/link"
import { cn } from "cn"

import { CategoryBadge } from "@/components/category-badge"
import { MatchStatusBadge } from "@/components/matches/match-status-badge"
import { ParticipantAvatars, SideName } from "@/components/matches/side-participants"
import type { MatchSide, MatchView } from "@/lib/data/types"
import { formatDayLabel, formatTime } from "@/lib/format"
import { SIDES, sideParticipants, sideScore, winnerSide } from "@/lib/matches"
import { hierarchyLabel, sportCategory, sportLabel } from "@/lib/sports"

type MatchRowProps = {
  match: MatchView
  /** Reference time for "Today" / "Tomorrow" labels. */
  now?: Date
  showLeague?: boolean
  /** Hide the day label when every row in the list is on the same day. */
  showDay?: boolean
  /** Use the league's short name, for narrow columns. */
  compact?: boolean
  /** Show the Sports/Esports badge beside the league label. */
  showCategory?: boolean
  /** Control rendered beside the row, outside the link (e.g. a watchlist star). */
  action?: React.ReactNode
  className?: string
}

/**
 * One match in a list: one line per side, in side order. The row links to
 * the match page; the league label is a separate link to the league page,
 * and `action` renders a control beside it. The match link is "stretched"
 * over the row so the whole row stays clickable without nesting anchors.
 */
export function MatchRow({
  match,
  now = new Date(),
  showLeague = true,
  showDay = true,
  compact = false,
  showCategory = false,
  action,
  className,
}: MatchRowProps) {
  const finished = match.status === "finished"
  const winner = winnerSide(match)

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
          {SIDES.map((side) => (
            <SideLine
              key={side}
              match={match}
              side={side}
              emphasized={winner === side}
              muted={finished && winner !== undefined && winner !== side}
            />
          ))}
        </div>
      </Link>

      <div className="flex shrink-0 flex-col items-end gap-1 text-right">
        <MatchStatusBadge status={match.status} liveDetail={match.liveDetail} />
        {showLeague ? (
          <span className="hidden max-w-48 items-center gap-1.5 sm:flex">
            {showCategory ? (
              <CategoryBadge category={sportCategory(match.league.sport)} size="sm" />
            ) : null}
            <Link
              href={`/leagues/${match.league.id}`}
              className="relative z-[2] truncate rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
              title={hierarchyLabel(match.league.sport, match.league.name)}
            >
              {compact
                ? match.league.shortName
                : `${sportLabel(match.league.sport)} · ${match.league.shortName}`}
            </Link>
          </span>
        ) : null}
      </div>

      {action ? <div className="relative z-[2] shrink-0">{action}</div> : null}
    </div>
  )
}

function SideLine({
  match,
  side,
  emphasized,
  muted,
}: {
  match: MatchView
  side: MatchSide
  emphasized?: boolean
  muted?: boolean
}) {
  const score = sideScore(match, side)
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 text-sm",
        muted && "text-muted-foreground"
      )}
    >
      <ParticipantAvatars participants={sideParticipants(match, side)} size="sm" />
      <SideName match={match} side={side} className={cn("truncate", emphasized && "font-semibold")} />
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
