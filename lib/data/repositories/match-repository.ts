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
  /** Only these matches (e.g. the watchlist). Empty matches nothing. */
  ids?: readonly string[]
  leagueId?: string
  /** Matches where any of these teams participates, on either side. */
  teamIds?: readonly string[]
  /** Matches where any of these players participates, on either side. */
  playerIds?: readonly string[]
  excludeId?: string
  status?: MatchStatus | { not: MatchStatus }
  startsAt?: { gt?: Date; gte?: Date; lt?: Date }
  /**
   * Matches the user follows: a followed team or player participates, or the
   * match is in a followed league. Empty lists match nothing.
   */
  followed?: { teamIds: readonly string[]; playerIds: readonly string[]; leagueIds: readonly string[] }
  /** Chronological by default. */
  order?: "asc" | "desc"
  limit?: number
}

/** Participation is a relation filter; the participant indexes serve it. */
function involves(ref: { teamIds?: readonly string[]; playerIds?: readonly string[] }): MatchWhereInput[] {
  const clauses: MatchWhereInput[] = []
  if (ref.teamIds !== undefined) clauses.push({ participants: { some: { teamId: { in: [...ref.teamIds] } } } })
  if (ref.playerIds !== undefined) clauses.push({ participants: { some: { playerId: { in: [...ref.playerIds] } } } })
  return clauses
}

function toWhere(query: MatchQuery): MatchWhereInput {
  const and: MatchWhereInput[] = []
  if (query.ids !== undefined) and.push({ id: { in: [...query.ids] } })
  if (query.leagueId !== undefined) and.push({ leagueId: query.leagueId })
  const participation = involves(query)
  if (participation.length > 0) and.push({ OR: participation })
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
        ...involves({ teamIds: query.followed.teamIds, playerIds: query.followed.playerIds }),
        { leagueId: { in: [...query.followed.leagueIds] } },
      ],
    })
  }
  return and.length === 0 ? {} : { AND: and }
}

/**
 * Upper bound for list reads that pass no explicit limit (Matches, History,
 * admin snapshots). Far above today's catalogue; a page that needs more
 * should add windows, not raise this.
 */
export const PUBLIC_LIST_LIMIT = 1000

export const matchRepository = {
  /** Matches joined with league, participants (with their team or player), and venue, ready to render. */
  async findViews(query: MatchQuery = {}): Promise<MatchView[]> {
    const order = query.order ?? "asc"
    const rows = await db.match.findMany({
      where: toWhere(query),
      include: matchInclude,
      // The id tiebreak keeps ordering stable when two matches share a start time.
      orderBy: [{ startsAt: order }, { id: "asc" }],
      take: query.limit ?? PUBLIC_LIST_LIMIT,
    })
    return rows.map(toMatchView)
  },

  async findViewById(id: string): Promise<MatchView | undefined> {
    const row = await db.match.findUnique({ where: { id }, include: matchInclude })
    return row ? toMatchView(row) : undefined
  },
}
