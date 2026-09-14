import "server-only"

import { db } from "@/lib/data/db"
import { teamInclude, toTeam, toTeamView } from "@/lib/data/repositories/mappers"
import { matchRepository } from "@/lib/data/repositories/match-repository"
import type { MatchView, Team, TeamView } from "@/lib/data/types"

/**
 * A match counts as a team's "next" one until three hours after kick-off, so
 * a live game still shows on the team card (same rule as the mock layer).
 */
const NEXT_MATCH_GRACE_MS = 3 * 3_600_000

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name)
}

/**
 * Next match per team in two queries regardless of team count: the teams,
 * then every live or upcoming match involving any of them, chronologically.
 * The first match seen for a team is its next one.
 */
async function nextMatchByTeam(teamIds: string[], now: Date): Promise<Map<string, MatchView>> {
  const next = new Map<string, MatchView>()
  if (teamIds.length === 0) return next
  const candidates = await matchRepository.findViews({
    teamIds,
    status: { not: "finished" },
    startsAt: { gt: new Date(now.getTime() - NEXT_MATCH_GRACE_MS) },
  })
  for (const match of candidates) {
    for (const teamId of [match.homeTeamId, match.awayTeamId]) {
      if (!next.has(teamId)) next.set(teamId, match)
    }
  }
  return next
}

export const teamRepository = {
  /** Every team, sorted by name. */
  async findMany(): Promise<Team[]> {
    const rows = await db.team.findMany()
    return rows.map(toTeam).sort(byName)
  },

  /** Teams with their league and next match, sorted by name. Optionally limited to one league. */
  async findViews(filter: { leagueId?: string } = {}, now = new Date()): Promise<TeamView[]> {
    const rows = await db.team.findMany({
      where: filter.leagueId === undefined ? undefined : { leagueId: filter.leagueId },
      include: teamInclude,
    })
    const next = await nextMatchByTeam(
      rows.map((row) => row.id),
      now
    )
    return rows.map((row) => toTeamView(row, next.get(row.id))).sort(byName)
  },

  async findViewById(id: string, now = new Date()): Promise<TeamView | undefined> {
    const row = await db.team.findUnique({ where: { id }, include: teamInclude })
    if (!row) return undefined
    const next = await nextMatchByTeam([row.id], now)
    return toTeamView(row, next.get(row.id))
  },
}
