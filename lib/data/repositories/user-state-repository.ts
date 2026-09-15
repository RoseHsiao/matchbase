import "server-only"

import { db } from "@/lib/data/db"
import type { UserFollows } from "@/lib/data/types"
import { Prisma } from "@/lib/generated/prisma/client"

/**
 * Persistence for the four user-state relationships:
 * User -> Team, Player, League (follows) and Match (watchlist).
 *
 * Every write is idempotent: following twice is one row, unfollowing an
 * absent row is a no-op. Uniqueness comes from the composite primary keys in
 * the schema, so concurrent requests cannot create duplicates. Foreign keys
 * reject unknown ids; that database error is turned into a plain Error with a
 * clear message rather than a silent insert.
 */

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003"
}

async function guarded(label: string, write: () => Promise<unknown>): Promise<void> {
  try {
    await write()
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new Error(`Cannot ${label}: the user or the referenced record does not exist.`)
    }
    throw error
  }
}

export const userStateRepository = {
  /** Every id the user follows or has saved: one query per relationship. */
  async getFollows(userId: string): Promise<UserFollows> {
    const [teams, players, leagues, watchlist] = await Promise.all([
      db.userTeamFollow.findMany({ where: { userId }, select: { teamId: true }, orderBy: [{ createdAt: "asc" }, { teamId: "asc" }] }),
      db.userPlayerFollow.findMany({ where: { userId }, select: { playerId: true }, orderBy: [{ createdAt: "asc" }, { playerId: "asc" }] }),
      db.userLeagueFollow.findMany({ where: { userId }, select: { leagueId: true }, orderBy: [{ createdAt: "asc" }, { leagueId: "asc" }] }),
      db.userWatchlistMatch.findMany({ where: { userId }, select: { matchId: true }, orderBy: [{ createdAt: "asc" }, { matchId: "asc" }] }),
    ])
    return {
      teamIds: teams.map((row) => row.teamId),
      playerIds: players.map((row) => row.playerId),
      leagueIds: leagues.map((row) => row.leagueId),
      watchlistMatchIds: watchlist.map((row) => row.matchId),
    }
  },

  followTeam(userId: string, teamId: string): Promise<void> {
    return guarded(`follow team "${teamId}"`, () =>
      db.userTeamFollow.upsert({
        where: { userId_teamId: { userId, teamId } },
        create: { userId, teamId },
        update: {},
      })
    )
  },

  async unfollowTeam(userId: string, teamId: string): Promise<void> {
    await db.userTeamFollow.deleteMany({ where: { userId, teamId } })
  },

  followPlayer(userId: string, playerId: string): Promise<void> {
    return guarded(`follow player "${playerId}"`, () =>
      db.userPlayerFollow.upsert({
        where: { userId_playerId: { userId, playerId } },
        create: { userId, playerId },
        update: {},
      })
    )
  },

  async unfollowPlayer(userId: string, playerId: string): Promise<void> {
    await db.userPlayerFollow.deleteMany({ where: { userId, playerId } })
  },

  followLeague(userId: string, leagueId: string): Promise<void> {
    return guarded(`follow league "${leagueId}"`, () =>
      db.userLeagueFollow.upsert({
        where: { userId_leagueId: { userId, leagueId } },
        create: { userId, leagueId },
        update: {},
      })
    )
  },

  async unfollowLeague(userId: string, leagueId: string): Promise<void> {
    await db.userLeagueFollow.deleteMany({ where: { userId, leagueId } })
  },

  addToWatchlist(userId: string, matchId: string): Promise<void> {
    return guarded(`add match "${matchId}" to the watchlist`, () =>
      db.userWatchlistMatch.upsert({
        where: { userId_matchId: { userId, matchId } },
        create: { userId, matchId },
        update: {},
      })
    )
  },

  async removeFromWatchlist(userId: string, matchId: string): Promise<void> {
    await db.userWatchlistMatch.deleteMany({ where: { userId, matchId } })
  },
}
