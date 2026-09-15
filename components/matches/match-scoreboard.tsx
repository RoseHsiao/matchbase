import Link from "next/link"
import { MapPinIcon } from "lucide-react"
import { cn } from "cn"

import { CategoryBadge } from "@/components/category-badge"
import { MatchStatusBadge } from "@/components/matches/match-status-badge"
import { ParticipantAvatars } from "@/components/matches/side-participants"
import { Card, CardContent } from "@/components/ui/card"
import type { MatchParticipantView, MatchView } from "@/lib/data/types"
import { formatDayLabel, formatKickoff, formatTime } from "@/lib/format"
import { participantName, sideParticipants, sideRole, winnerSide } from "@/lib/matches"
import { sportCategory, sportLabel } from "@/lib/sports"

type MatchScoreboardProps = {
  match: MatchView
  now?: Date
  className?: string
}

/** Hero panel for the match detail page. Adapts to upcoming, live, and finished, and to teams or players per side. */
export function MatchScoreboard({ match, now, className }: MatchScoreboardProps) {
  const { status, score } = match
  const finished = status === "finished"
  const live = status === "live"
  const winner = winnerSide(match)
  const sport = match.league.sport

  return (
    <Card className={cn(live && "ring-red-500/30", className)}>
      <CardContent className="grid gap-6 py-2">
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-sm text-muted-foreground">
          <CategoryBadge category={sportCategory(sport)} />
          <span>{sportLabel(sport)}</span>
          <span aria-hidden>·</span>
          <Link
            href={`/leagues/${match.league.id}`}
            className="rounded-sm outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {match.league.name}
          </Link>
          {match.stage ? (
            <>
              <span aria-hidden>·</span>
              <span>{match.stage}</span>
            </>
          ) : null}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-6">
          <SideBlock
            participants={sideParticipants(match, "A")}
            role={sideRole(sport, "A")}
            emphasized={winner === "A"}
            muted={finished && winner === "B"}
          />

          <div className="grid shrink-0 justify-items-center gap-2">
            {score ? (
              <div className="flex items-baseline gap-2 text-3xl font-semibold tabular-nums sm:gap-3 sm:text-5xl">
                <span className={cn(finished && winner === "B" && "text-muted-foreground")}>
                  {score.a}
                </span>
                <span className="text-2xl text-muted-foreground sm:text-3xl">–</span>
                <span className={cn(finished && winner === "A" && "text-muted-foreground")}>
                  {score.b}
                </span>
              </div>
            ) : (
              <time
                dateTime={match.startsAt}
                className="grid justify-items-center leading-tight"
              >
                <span className="text-2xl font-semibold tabular-nums sm:text-4xl">
                  {formatTime(match.startsAt)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {formatDayLabel(match.startsAt, now)}
                </span>
              </time>
            )}
            <MatchStatusBadge status={status} liveDetail={match.liveDetail} />
          </div>

          <SideBlock
            participants={sideParticipants(match, "B")}
            role={sideRole(sport, "B")}
            emphasized={winner === "B"}
            muted={finished && winner === "A"}
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

/**
 * One side: a team block linking to the team page, or one link per player
 * (a doubles pair stacks two). The role label appears only for sports with
 * home advantage.
 */
function SideBlock({
  participants,
  role,
  emphasized,
  muted,
}: {
  participants: MatchParticipantView[]
  role?: "Home" | "Away"
  emphasized?: boolean
  muted?: boolean
}) {
  const single = participants.length === 1 ? participants[0] : undefined
  const href = single?.team ? `/teams/${single.team.id}` : single?.player ? `/players/${single.player.id}` : undefined
  const subline = single?.team ? single.team.code : undefined

  const body = (
    <>
      {/* A pair shows two portraits; step down one size so both sides and the centre fit at phone width. */}
      <ParticipantAvatars participants={participants} size={participants.length > 1 ? "lg" : "xl"} />
      <span className="grid min-w-0 justify-items-center leading-tight">
        {participants.map((p) => (
          <span
            key={p.id}
            className={cn(
              "max-w-full truncate text-sm sm:text-lg",
              emphasized ? "font-semibold" : "font-medium"
            )}
          >
            {href ? participantName(p) : (
              <Link
                href={p.team ? `/teams/${p.team.id}` : `/players/${p.player?.id ?? ""}`}
                className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {participantName(p)}
              </Link>
            )}
          </span>
        ))}
        {subline || role ? (
          <span className="text-xs text-muted-foreground">
            {[subline, role].filter(Boolean).join(" · ")}
          </span>
        ) : null}
      </span>
    </>
  )

  const className = cn(
    "grid min-w-0 justify-items-center gap-2 rounded-lg p-2 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
    href && "hover:bg-muted/60",
    muted && "text-muted-foreground"
  )
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}
