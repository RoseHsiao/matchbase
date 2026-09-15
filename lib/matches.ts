import type { Match, MatchParticipantView, MatchSide, MatchView, Sport } from "@/lib/data/types"
import { hasHomeAdvantage } from "@/lib/sports"

/**
 * Pure presentation helpers over the participant model. Components never
 * reason about "home" or "away" themselves; they ask these helpers, which
 * read the sport registry. Safe on the client (no data access).
 */

export const SIDES: readonly MatchSide[] = ["A", "B"]

export function otherSide(side: MatchSide): MatchSide {
  return side === "A" ? "B" : "A"
}

/** Participants of one side, in position order. */
export function sideParticipants<P extends { side: MatchSide; order: number }>(match: { participants: P[] }, side: MatchSide): P[] {
  return match.participants.filter((p) => p.side === side).sort((a, b) => a.order - b.order)
}

/** "Home" / "Away" for sports with home advantage; undefined otherwise. */
export function sideRole(sport: Sport, side: MatchSide): "Home" | "Away" | undefined {
  if (!hasHomeAdvantage(sport)) return undefined
  return side === "A" ? "Home" : "Away"
}

export type NameVariant = "full" | "short" | "code"

/** A participant's display name: team name / short name / code, or the player's handle or name. */
export function participantName(participant: MatchParticipantView, variant: NameVariant = "full"): string {
  if (participant.team) {
    return variant === "code" ? participant.team.code : variant === "short" ? participant.team.shortName : participant.team.name
  }
  if (participant.player) {
    const { player } = participant
    if (variant === "code") return player.handle ?? initials(player.name)
    return player.handle ?? player.name
  }
  return participant.teamId ?? participant.playerId ?? "?"
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 3)
}

/** "Los Angeles Lakers", "T1", "Alcaraz", or "Hsieh / Ostapenko" for a pair. */
export function sideName(match: Pick<MatchView, "participants">, side: MatchSide, variant: NameVariant = "full"): string {
  return sideParticipants(match, side).map((p) => participantName(p, variant)).join(" / ")
}

export function sideScore(match: Pick<Match, "score">, side: MatchSide): number | undefined {
  if (!match.score) return undefined
  return side === "A" ? match.score.a : match.score.b
}

/** The winning side of a finished match with a decisive score; undefined for draws and unfinished matches. */
export function winnerSide(match: Pick<Match, "status" | "score">): MatchSide | undefined {
  if (match.status !== "finished" || !match.score || match.score.a === match.score.b) return undefined
  return match.score.a > match.score.b ? "A" : "B"
}

/** "Los Angeles Lakers vs Boston Celtics" */
export function matchTitle(match: Pick<MatchView, "participants">, variant: NameVariant = "full"): string {
  return `${sideName(match, "A", variant)} vs ${sideName(match, "B", variant)}`
}

export function matchInvolvesTeam(match: Pick<Match, "participants">, teamId: string): boolean {
  return match.participants.some((p) => p.teamId === teamId)
}

export function matchInvolvesPlayer(match: Pick<Match, "participants">, playerId: string): boolean {
  return match.participants.some((p) => p.playerId === playerId)
}

/** Which side a team or player is on, if any. */
export function sideOf(match: Pick<Match, "participants">, ref: { teamId?: string; playerId?: string }): MatchSide | undefined {
  return match.participants.find((p) => (ref.teamId !== undefined && p.teamId === ref.teamId) || (ref.playerId !== undefined && p.playerId === ref.playerId))?.side
}

/** Every searchable name on both sides: team names, short names, codes, player names, handles. */
export function participantSearchTerms(match: Pick<MatchView, "participants">): string[] {
  const terms: string[] = []
  for (const p of match.participants) {
    if (p.team) terms.push(p.team.name, p.team.shortName, p.team.code)
    if (p.player) terms.push(p.player.name, p.player.handle ?? "")
  }
  return terms.filter(Boolean)
}
