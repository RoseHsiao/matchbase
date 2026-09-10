import { ChevronRightIcon } from "lucide-react"
import { cn } from "cn"

import { ListRowLink } from "@/components/list-row-link"
import { LiveDot, liveTextClassName } from "@/components/matches/match-status-badge"
import { TeamLogo } from "@/components/matches/team-logo"
import type { TeamView } from "@/lib/data/types"
import { formatDayLabel, formatTime } from "@/lib/format"

type TeamCardProps = {
  team: TeamView
  now?: Date
  className?: string
}

/** Compact followed-team tile linking to the team page. */
export function TeamCard({ team, now = new Date(), className }: TeamCardProps) {
  const next = team.nextMatch
  const opponent = next
    ? next.homeTeamId === team.id
      ? next.awayTeam
      : next.homeTeam
    : undefined
  const isHome = next?.homeTeamId === team.id

  return (
    <ListRowLink href={`/teams/${team.id}`} className={className}>
      <TeamLogo team={team} size="lg" />
      <div className="grid min-w-0 flex-1 overflow-hidden">
        <span className="truncate text-sm font-medium">{team.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {team.league.name}
        </span>
      </div>
      <div className="shrink-0 text-right text-xs">
        {next && opponent ? (
          next.status === "live" ? (
            <>
              <div
                className={cn(
                  "flex items-center justify-end gap-1.5 font-medium",
                  liveTextClassName
                )}
              >
                <LiveDot />
                Live now
              </div>
              <div className="text-muted-foreground">
                {isHome ? "vs" : "at"} {opponent.code}
              </div>
            </>
          ) : (
            <>
              <div className="font-medium">
                {isHome ? "vs" : "at"} {opponent.code}
              </div>
              <time
                dateTime={next.startsAt}
                className="block text-muted-foreground tabular-nums"
              >
                {formatDayLabel(next.startsAt, now)} · {formatTime(next.startsAt)}
              </time>
            </>
          )
        ) : (
          <span className="text-muted-foreground">No upcoming fixture</span>
        )}
      </div>
      <ChevronRightIcon
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
    </ListRowLink>
  )
}
