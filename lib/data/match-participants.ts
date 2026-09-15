import type { MatchSide } from "@/lib/data/types"

/**
 * Shared, side-effect-free validation of a match's participant set. Used by
 * the admin write path, the sync service, and tests, so every writer applies
 * the same rules. Database constraints back the ones they can express
 * (positive order, one reference per row, unique position, unique team or
 * player per match); the rest live only here.
 *
 * Rules
 * 1. At least one participant on side A and one on side B.
 * 2. Each participant references exactly one team or one player.
 * 3. Positions are integers from 1 and unique within a side.
 * 4. A team or player appears at most once in the match (so never on both sides).
 * 5. A side is homogeneous: all teams or all players.
 * 6. A team side holds exactly one team (team sports are one team per side);
 *    a player side may hold several players (doubles).
 */

export type ParticipantInput = {
  side: MatchSide
  order: number
  teamId?: string
  playerId?: string
}

export type ParticipantValidation =
  | { ok: true; participants: ParticipantInput[] }
  | { ok: false; error: string }

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200
}

function fail(error: string): ParticipantValidation {
  return { ok: false, error }
}

export function validateParticipants(input: unknown): ParticipantValidation {
  if (!Array.isArray(input) || input.length === 0) return fail("A match needs participants on both sides.")
  const participants: ParticipantInput[] = []
  const positions = new Set<string>()
  const refs = new Set<string>()
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) return fail("Invalid participant.")
    const p = raw as Record<string, unknown>
    if (p.side !== "A" && p.side !== "B") return fail("Each participant must be on side A or side B.")
    const order = typeof p.order === "number" ? p.order : Number.NaN
    if (!Number.isInteger(order) || order < 1) return fail("Participant positions must be whole numbers from 1.")
    const teamId = isId(p.teamId) ? p.teamId : undefined
    const playerId = isId(p.playerId) ? p.playerId : undefined
    if ((teamId === undefined) === (playerId === undefined)) return fail("Each participant must be exactly one team or one player.")
    const position = `${p.side}:${order}`
    if (positions.has(position)) return fail(`Side ${p.side} has two participants at position ${order}.`)
    positions.add(position)
    const ref = teamId !== undefined ? `team:${teamId}` : `player:${playerId}`
    if (refs.has(ref)) return fail("The same team or player cannot appear twice in a match.")
    refs.add(ref)
    participants.push({ side: p.side, order, teamId, playerId })
  }
  for (const side of ["A", "B"] as const) {
    const onSide = participants.filter((p) => p.side === side)
    if (onSide.length === 0) return fail(`Side ${side} has no participant.`)
    const teams = onSide.filter((p) => p.teamId !== undefined).length
    if (teams > 0 && teams !== onSide.length) return fail(`Side ${side} mixes a team with players.`)
    if (teams > 1) return fail(`Side ${side} can hold only one team.`)
  }
  participants.sort((a, b) => (a.side === b.side ? a.order - b.order : a.side < b.side ? -1 : 1))
  return { ok: true, participants }
}

/** Build participant inputs from ordered id lists per side. */
export function participantsFromSides(sides: { A: ParticipantRef[]; B: ParticipantRef[] }): ParticipantInput[] {
  const build = (side: MatchSide, refs: ParticipantRef[]) => refs.map((ref, index) => ({ side, order: index + 1, ...ref }))
  return [...build("A", sides.A), ...build("B", sides.B)]
}

export type ParticipantRef = { teamId: string; playerId?: undefined } | { playerId: string; teamId?: undefined }
