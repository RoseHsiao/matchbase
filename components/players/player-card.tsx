import Link from "next/link"
import { cn } from "cn"

import { TeamLogo } from "@/components/matches/team-logo"
import { PlayerAvatar } from "@/components/players/player-avatar"
import { PlayerFollowButton } from "@/components/players/player-follow-button"
import { Card, CardContent } from "@/components/ui/card"
import type { PlayerView } from "@/lib/data/types"
import { playerDisplayName } from "@/lib/players"
import { sportLabel } from "@/lib/sports"

type PlayerCardProps = {
  player: PlayerView
  className?: string
}

/**
 * Grid card for browsing players. Name links to the player page and the team
 * links to the team page; the follow button is a separate control.
 */
export function PlayerCard({ player, className }: PlayerCardProps) {
  const displayName = playerDisplayName(player)

  return (
    <Card size="sm" className={cn("min-w-0", className)}>
      <CardContent className="flex items-start gap-3">
        <Link
          href={`/players/${player.id}`}
          aria-label={displayName}
          className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <PlayerAvatar player={player} size="lg" />
        </Link>

        <div className="grid min-w-0 flex-1 gap-1">
          <div className="grid min-w-0 leading-tight">
            <Link
              href={`/players/${player.id}`}
              className="min-w-0 truncate text-sm font-semibold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {displayName}
            </Link>
            <span className="truncate text-xs text-muted-foreground">
              {player.handle ? `${player.name} · ${player.role}` : player.role}
            </span>
          </div>
          <Link
            href={`/teams/${player.team.id}`}
            className="flex w-fit min-w-0 items-center gap-1.5 rounded-md text-xs outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <TeamLogo team={player.team} size="xs" />
            <span className="truncate">{player.team.name}</span>
          </Link>
          <div className="truncate text-xs text-muted-foreground">
            {sportLabel(player.league.sport)} · {player.league.name}
          </div>
          <div className="mt-1">
            <PlayerFollowButton playerId={player.id} playerName={displayName} size="sm" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
