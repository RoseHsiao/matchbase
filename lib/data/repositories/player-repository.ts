import "server-only"

import { db } from "@/lib/data/db"
import { playerInclude, toPlayer, toPlayerView } from "@/lib/data/repositories/mappers"
import type { Player, PlayerView } from "@/lib/data/types"
import { playerDisplayName } from "@/lib/players"

function byDisplayName<T extends Pick<Player, "name" | "handle">>(a: T, b: T): number {
  return playerDisplayName(a).localeCompare(playerDisplayName(b))
}

/**
 * User-facing reads only include players who have a team, because the domain
 * Player type requires one (see mappers.ts).
 */
export const playerRepository = {
  /** Every player with their team and league, sorted by display name. */
  async findViews(): Promise<PlayerView[]> {
    const rows = await db.player.findMany({
      where: { teamId: { not: null } },
      include: playerInclude,
    })
    return rows.map(toPlayerView).sort(byDisplayName)
  },

  async findViewById(id: string): Promise<PlayerView | undefined> {
    const row = await db.player.findUnique({ where: { id }, include: playerInclude })
    return row && row.teamId !== null ? toPlayerView(row) : undefined
  },

  /** A team's roster, sorted by display name. */
  async findByTeam(teamId: string): Promise<Player[]> {
    const rows = await db.player.findMany({ where: { teamId }, include: playerInclude })
    return rows.map(toPlayer).sort(byDisplayName)
  },
}
