import { validateParticipants, type ParticipantInput } from "@/lib/data/match-participants"
import type { NormalizedIndividualMatch, NormalizedMatch, NormalizedSide } from "@/lib/data/sync/types"

/**
 * Turns a normalized match's sides into participant inputs by resolving each
 * provider external id to an internal id. Pure, so it is unit-testable;
 * the sync service supplies the maps it built while upserting teams and
 * players. Throws with a record-level message when a reference is unknown or
 * the participant rules are violated.
 */

export type ParticipantResolvers = {
  teamIds: ReadonlyMap<string, string>
  playerIds: ReadonlyMap<string, string>
}

export type ResolvedSides = {
  participants: ParticipantInput[]
  sideAScore: number | undefined
  sideBScore: number | undefined
}

/** A team-vs-team normalized match expressed as two single-team sides. */
export function sidesOfTeamMatch(match: NormalizedMatch): [NormalizedSide, NormalizedSide] {
  return [
    { participants: [{ kind: "team", externalId: match.homeTeamExternalId }], score: match.homeScore },
    { participants: [{ kind: "team", externalId: match.awayTeamExternalId }], score: match.awayScore },
  ]
}

export function resolveSides(sides: [NormalizedSide, NormalizedSide], resolvers: ParticipantResolvers): ResolvedSides {
  const inputs: ParticipantInput[] = []
  sides.forEach((side, index) => {
    const key = index === 0 ? "A" : "B"
    side.participants.forEach((participant, position) => {
      if (participant.kind === "team") {
        const teamId = resolvers.teamIds.get(participant.externalId)
        if (!teamId) throw new Error(`Team ${participant.externalId} was not synced.`)
        inputs.push({ side: key, order: position + 1, teamId })
      } else {
        const playerId = resolvers.playerIds.get(participant.externalId)
        if (!playerId) throw new Error(`Player ${participant.externalId} was not synced.`)
        inputs.push({ side: key, order: position + 1, playerId })
      }
    })
  })
  const validation = validateParticipants(inputs)
  if (!validation.ok) throw new Error(validation.error)
  const paired = sides[0].score !== undefined && sides[1].score !== undefined
  return {
    participants: validation.participants,
    sideAScore: paired ? sides[0].score : undefined,
    sideBScore: paired ? sides[1].score : undefined,
  }
}

/** Both normalized match shapes reduced to what persistence needs. */
export type PersistableMatch = {
  externalId: string
  leagueExternalId: string
  seasonExternalId: string
  venueExternalId?: string
  startsAt: string
  status: NormalizedMatch["status"]
  stage?: string
  liveDetail?: string
  sides: [NormalizedSide, NormalizedSide]
  /** True when only one side carried a score and both were dropped. */
  loneScore: boolean
}

export function toPersistable(match: NormalizedMatch | NormalizedIndividualMatch): PersistableMatch {
  const sides: [NormalizedSide, NormalizedSide] = "sides" in match ? match.sides : sidesOfTeamMatch(match)
  const loneScore = (sides[0].score === undefined) !== (sides[1].score === undefined)
  return {
    externalId: match.externalId,
    leagueExternalId: match.leagueExternalId,
    seasonExternalId: match.seasonExternalId,
    venueExternalId: match.venueExternalId,
    startsAt: match.startsAt,
    status: match.status,
    stage: match.stage,
    liveDetail: match.liveDetail,
    sides,
    loneScore,
  }
}
