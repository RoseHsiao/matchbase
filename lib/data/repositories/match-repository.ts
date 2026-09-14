import "server-only"

import { db } from "@/lib/data/db"
import { matchInclude, toMatchView } from "@/lib/data/repositories/mappers"
import type { MatchStatus, MatchView } from "@/lib/data/types"
import type { MatchStatus as DbMatchStatus } from "@/lib/generated/prisma/enums"
import type { MatchWhereInput } from "@/lib/generated/prisma/models"

const dbStatus: Record<MatchStatus, DbMatchStatus> = {
  upcoming: "UPCOMING",
  live: "LIVE",
  finished: "FINISHED",
}

/** Declarative filter for match reads. Every field narrows; omitted fields do not filter. */
export type MatchQuery = {
  leagueId?: string
  /** Matches where any of these teams plays, home or away. */
  teamIds?: readonly string[]
  excludeId?: string
  status?: MatchStatus | { not: MatchStatus }
  startsAt?: { gt?: Date; gte?: Date; lt?: Date }
  /**
   * Matches the user follows: any listed team plays, or the match is in a
   * listed league. Empty lists match nothing, like the mock implementation.
   */
  followed?: { teamIds: readonly string[]; leagueIds: readonly string[] }
  /** Chronological by default. */
  order?: "asc" | "desc"
  limit?: number
}

function involvesAny(teamIds: readonly string[]): MatchWhereInput {
  const ids = [...teamIds]
  return { OR: [{ homeTeamId: { in: ids } }, { awayTeamId: { in: ids } }] }
}

function toWhere(query: MatchQuery): MatchWhereInput {
  const and: MatchWhereInput[] = []
  if (query.leagueId !== undefined) and.push({ leagueId: query.leagueId })
  if (query.teamIds !== undefined) and.push(involvesAny(query.teamIds))
  if (query.excludeId !== undefined) and.push({ id: { not: query.excludeId } })
  if (query.status !== undefined) {
    and.push(
      typeof query.status === "string"
        ? { status: dbStatus[query.status] }
        : { status: { not: dbStatus[query.status.not] } }
    )
  }
  if (query.startsAt !== undefined) and.push({ startsAt: query.startsAt })
  if (query.followed !== undefined) {
    and.push({
      OR: [
        ...(involvesAny(query.followed.teamIds).OR ?? []),
        { leagueId: { in: [...query.followed.leagueIds] } },
      ],
    })
  }
  return and.length === 0 ? {} : { AND: and }
}

export const matchRepository = {
  /** Matches joined with league, both teams, and venue, ready to render. */
  async findViews(query: MatchQuery = {}): Promise<MatchView[]> {
    const order = query.order ?? "asc"
    const rows = await db.match.findMany({
      where: toWhere(query),
      include: matchInclude,
      // The id tiebreak keeps ordering stable when two matches share a start time.
      orderBy: [{ startsAt: order }, { id: "asc" }],
      take: query.limit,
    })
    return rows.map(toMatchView)
  },

  async findViewById(id: string): Promise<MatchView | undefined> {
    const row = await db.match.findUnique({ where: { id }, include: matchInclude })
    return row ? toMatchView(row) : undefined
  },
}
