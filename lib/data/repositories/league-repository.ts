import "server-only"

import { db } from "@/lib/data/db"
import { leagueInclude, toLeague } from "@/lib/data/repositories/mappers"
import type { League } from "@/lib/data/types"

/**
 * Leagues are listed in catalogue order: sport registry order first (Sports
 * before Esports, football before basketball, and so on), then by name.
 */
export const leagueRepository = {
  async findMany(): Promise<League[]> {
    const rows = await db.league.findMany({
      include: leagueInclude,
      orderBy: [{ sport: { sortOrder: "asc" } }, { name: "asc" }],
    })
    return rows.map(toLeague)
  },

  async findById(id: string): Promise<League | undefined> {
    const row = await db.league.findUnique({ where: { id }, include: leagueInclude })
    return row ? toLeague(row) : undefined
  },

  async findByIds(ids: readonly string[]): Promise<League[]> {
    if (ids.length === 0) return []
    const rows = await db.league.findMany({ where: { id: { in: [...ids] } }, include: leagueInclude })
    return rows.map(toLeague)
  },
}
