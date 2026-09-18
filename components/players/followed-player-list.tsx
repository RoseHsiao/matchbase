"use client"

import Link from "next/link"
import { ChevronRightIcon, UserRoundIcon } from "lucide-react"

import { useViewer } from "@/components/auth/viewer-provider"
import { EmptyState } from "@/components/empty-state"
import { ListRowLink } from "@/components/list-row-link"
import { PlayerAvatar } from "@/components/players/player-avatar"
import { usePlayerFollows } from "@/components/players/player-follows-provider"
import { SportLine } from "@/components/sport-icon"
import { buttonVariants } from "@/components/ui/button"
import type { PlayerView } from "@/lib/data/types"
import { playerDisplayName } from "@/lib/players"

type FollowedPlayerListProps = {
  /** Candidate players; only followed ones are shown. */
  players: PlayerView[]
  limit?: number
}

/** Dashboard panel body: followed players with their team (or "Independent") and competition. */
export function FollowedPlayerList({ players, limit = 6 }: FollowedPlayerListProps) {
  const viewer = useViewer()
  const { ids } = usePlayerFollows()
  const followed = players.filter((player) => ids.has(player.id))

  if (!viewer) {
    return (
      <EmptyState
        icon={UserRoundIcon}
        title="Sign in to follow players"
        description="Followed players and their teams appear here."
        action={
          <Link href="/sign-in?next=%2Fdashboard" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Sign in
          </Link>
        }
        className="mx-2"
      />
    )
  }

  if (followed.length === 0) {
    return (
      <EmptyState
        icon={UserRoundIcon}
        title="You're not following any players"
        description="Follow a player to keep them here."
        action={
          <Link href="/players" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Browse players
          </Link>
        }
        className="mx-2"
      />
    )
  }

  const shown = followed.slice(0, limit)
  const hidden = followed.length - shown.length

  return (
    <ul className="grid gap-0.5">
      {shown.map((player) => (
        <li key={player.id}>
          <ListRowLink href={`/players/${player.id}`} className="py-2">
            <PlayerAvatar player={player} size="default" />
            <span className="grid min-w-0 flex-1 leading-tight">
              <span className="truncate text-sm font-medium">{playerDisplayName(player)}</span>
              <span className="truncate text-xs text-muted-foreground">
                {player.team ? player.team.name : "Independent"}
                {player.role ? ` · ${player.role}` : ""}
              </span>
            </span>
            {player.league ? (
              <SportLine sport={player.league.sport} league={{ id: player.league.id, label: player.league.shortName }} size="xs" className="hidden shrink-0 text-xs text-muted-foreground sm:inline-flex" />
            ) : null}
            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </ListRowLink>
        </li>
      ))}
      {hidden > 0 ? (
        <li className="px-3 pt-1 text-xs text-muted-foreground">
          <Link href="/players" className="rounded-sm outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">
            {hidden} more followed {hidden === 1 ? "player" : "players"}
          </Link>
        </li>
      ) : null}
    </ul>
  )
}
