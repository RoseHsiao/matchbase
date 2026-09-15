import Link from "next/link"
import { cn } from "cn"

import { TeamLogo } from "@/components/matches/team-logo"
import { PlayerAvatar } from "@/components/players/player-avatar"
import type { MatchParticipantView, MatchSide, MatchView } from "@/lib/data/types"
import { participantName, sideParticipants, type NameVariant } from "@/lib/matches"

type ParticipantAvatarsProps = {
  participants: MatchParticipantView[]
  size?: "xs" | "sm" | "lg" | "xl"
  className?: string
}

/** Team crest or player portraits for one side; a doubles pair shows both portraits overlapped. */
export function ParticipantAvatars({ participants, size = "sm", className }: ParticipantAvatarsProps) {
  const teamSize = size === "xl" ? "xl" : size === "lg" ? "lg" : size
  return (
    <span className={cn("flex shrink-0 items-center", participants.length > 1 && "-space-x-1.5", className)}>
      {participants.map((p) =>
        p.team ? (
          <TeamLogo key={p.id} team={p.team} size={teamSize} />
        ) : p.player ? (
          <PlayerAvatar key={p.id} player={p.player} size={size === "xs" ? "sm" : size} className="ring-2 ring-background" />
        ) : null
      )}
    </span>
  )
}

type SideNameProps = {
  match: Pick<MatchView, "participants">
  side: MatchSide
  variant?: NameVariant
  /** Render each participant as a link to its team or player page. */
  linked?: boolean
  className?: string
}

/**
 * "Los Angeles Lakers", "T1", or "Hsieh / Ostapenko". With `linked`, each
 * participant links to its own page; the separator stays plain text.
 */
export function SideName({ match, side, variant = "full", linked = false, className }: SideNameProps) {
  const participants = sideParticipants(match, side)
  return (
    <span className={cn("min-w-0", className)}>
      {participants.map((p, index) => {
        const label = participantName(p, variant)
        const href = p.team ? `/teams/${p.team.id}` : p.player ? `/players/${p.player.id}` : undefined
        return (
          <span key={p.id}>
            {index > 0 ? <span className="text-muted-foreground"> / </span> : null}
            {linked && href ? (
              <Link href={href} className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">
                {label}
              </Link>
            ) : (
              label
            )}
          </span>
        )
      })}
    </span>
  )
}
