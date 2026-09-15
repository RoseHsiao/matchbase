import type { MatchStatus, WatchlistReminder } from "@/lib/data/types"
import type { Prisma } from "@/lib/generated/prisma/client"
import type { MatchStatus as DbMatchStatus, WatchlistReminder as DbWatchlistReminder } from "@/lib/generated/prisma/enums"
import { validateReminderChange } from "@/lib/watchlist/reminder-rules"

/**
 * Reminder persistence, written against a Prisma client passed in rather than
 * the server-only singleton so the same code runs inside the application
 * (lib/data/repositories/user-state-repository.ts) and inside the database
 * tests, which wrap each case in a transaction they roll back.
 */

export type ReminderClient = Pick<Prisma.TransactionClient, "user" | "match" | "userWatchlistMatch">

export const toDbReminder: Record<WatchlistReminder, DbWatchlistReminder> = {
  off: "OFF",
  at_start: "AT_START",
  "5m": "MIN_5",
  "15m": "MIN_15",
  "30m": "MIN_30",
  "1h": "HOUR_1",
  "1d": "DAY_1",
}

export const fromDbReminder: Record<DbWatchlistReminder, WatchlistReminder> = {
  OFF: "off",
  AT_START: "at_start",
  MIN_5: "5m",
  MIN_15: "15m",
  MIN_30: "30m",
  HOUR_1: "1h",
  DAY_1: "1d",
}

const fromDbStatus: Record<DbMatchStatus, MatchStatus> = { UPCOMING: "upcoming", LIVE: "live", FINISHED: "finished" }

/** A rule violation or a missing record, reported with a message safe to show. */
export class ReminderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ReminderError"
  }
}

/**
 * Store the reminder for one watchlisted match. Validates that the user and
 * match exist, that the match is watchlisted when the reminder is not OFF,
 * and that the match has not started. OFF on a match that is not watchlisted
 * changes nothing.
 */
export async function setWatchlistReminder(
  client: ReminderClient,
  userId: string,
  matchId: string,
  reminder: unknown
): Promise<WatchlistReminder> {
  const [user, match, entry] = await Promise.all([
    client.user.findUnique({ where: { id: userId }, select: { id: true } }),
    client.match.findUnique({ where: { id: matchId }, select: { status: true } }),
    client.userWatchlistMatch.findUnique({ where: { userId_matchId: { userId, matchId } }, select: { reminder: true } }),
  ])
  if (!user) throw new ReminderError("The user does not exist.")
  if (!match) throw new ReminderError("The match does not exist.")
  const result = validateReminderChange({ reminder, matchStatus: fromDbStatus[match.status], watchlisted: entry !== null })
  if (!result.ok) throw new ReminderError(result.error)
  if (entry === null) return "off"
  await client.userWatchlistMatch.update({
    where: { userId_matchId: { userId, matchId } },
    data: { reminder: toDbReminder[result.reminder] },
  })
  return result.reminder
}

/** Reminder per watchlisted match id, in save order. */
export async function getWatchlistReminders(client: ReminderClient, userId: string): Promise<Record<string, WatchlistReminder>> {
  const rows = await client.userWatchlistMatch.findMany({
    where: { userId },
    select: { matchId: true, reminder: true },
    orderBy: [{ createdAt: "asc" }, { matchId: "asc" }],
  })
  return Object.fromEntries(rows.map((row) => [row.matchId, fromDbReminder[row.reminder]]))
}
