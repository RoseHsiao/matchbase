import "server-only"

import { db } from "@/lib/data/db"
import { toSeason } from "@/lib/data/repositories/mappers"
import type { Season } from "@/lib/data/types"

const STATUS_ORDER: Record<Season["status"], number> = { current: 0, upcoming: 1, completed: 2 }

export const seasonRepository = {
  /** Seasons for a league: current first, then upcoming, then completed, newest first within a group. */
  async findByLeague(leagueId: string): Promise<Season[]> {
    const rows = await db.season.findMany({ where: { leagueId } })
    return rows
      .map(toSeason)
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.startsAt.localeCompare(a.startsAt))
  },
}
