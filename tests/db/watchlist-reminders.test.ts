import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { after, before, describe, it } from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"

import { DEMO_USER_ID } from "../../lib/data/demo-user"
import { getWatchlistReminders, ReminderError, setWatchlistReminder, type ReminderClient } from "../../lib/data/repositories/watchlist-reminder-ops"
import { PrismaClient } from "../../lib/generated/prisma/client"

/**
 * Persistence tests for watchlist reminders against the real database. Every
 * case runs inside a transaction that is rolled back at the end, so the
 * database is left exactly as it was. Skipped when no database URL is
 * configured (CI without secrets).
 */

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file)
}
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

class Rollback extends Error {}

describeDb("watchlist reminders (database)", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) })
  let upcomingId = ""
  let liveId = ""
  let finishedId = ""

  before(async () => {
    const pick = async (status: "UPCOMING" | "LIVE" | "FINISHED") => (await prisma.match.findFirstOrThrow({ where: { status }, orderBy: { id: "asc" }, select: { id: true } })).id
    ;[upcomingId, liveId, finishedId] = await Promise.all([pick("UPCOMING"), pick("LIVE"), pick("FINISHED")])
  })

  after(async () => {
    await prisma.$disconnect()
  })

  /** Run `body` inside a transaction that always rolls back. */
  async function withRollback(body: (tx: ReminderClient) => Promise<void>): Promise<void> {
    await prisma
      .$transaction(async (tx) => {
        await body(tx)
        throw new Rollback()
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error
      })
  }

  const user = DEMO_USER_ID
  const stored = async (tx: ReminderClient, matchId: string) => (await getWatchlistReminders(tx, user))[matchId]

  it("a saved match can take a reminder, and the update persists", async () => {
    await withRollback(async (tx) => {
      await tx.userWatchlistMatch.deleteMany({ where: { userId: user, matchId: upcomingId } })
      await tx.userWatchlistMatch.create({ data: { userId: user, matchId: upcomingId } })
      assert.equal(await stored(tx, upcomingId), "off")
      assert.equal(await setWatchlistReminder(tx, user, upcomingId, "15m"), "15m")
      assert.equal(await stored(tx, upcomingId), "15m")
      assert.equal(await setWatchlistReminder(tx, user, upcomingId, "1h"), "1h")
      assert.equal(await stored(tx, upcomingId), "1h")
    })
  })

  it("OFF keeps the match on the watchlist", async () => {
    await withRollback(async (tx) => {
      await tx.userWatchlistMatch.upsert({ where: { userId_matchId: { userId: user, matchId: upcomingId } }, create: { userId: user, matchId: upcomingId, reminder: "MIN_30" }, update: { reminder: "MIN_30" } })
      assert.equal(await setWatchlistReminder(tx, user, upcomingId, "off"), "off")
      const row = await tx.userWatchlistMatch.findUnique({ where: { userId_matchId: { userId: user, matchId: upcomingId } } })
      assert.ok(row, "row still exists")
      assert.equal(row?.reminder, "OFF")
    })
  })

  it("removing the match from the watchlist removes the reminder with it", async () => {
    await withRollback(async (tx) => {
      await tx.userWatchlistMatch.upsert({ where: { userId_matchId: { userId: user, matchId: upcomingId } }, create: { userId: user, matchId: upcomingId, reminder: "DAY_1" }, update: { reminder: "DAY_1" } })
      await tx.userWatchlistMatch.deleteMany({ where: { userId: user, matchId: upcomingId } })
      assert.equal(await stored(tx, upcomingId), undefined)
      // Saving it again starts from OFF: no preference survives removal.
      await tx.userWatchlistMatch.create({ data: { userId: user, matchId: upcomingId } })
      assert.equal(await stored(tx, upcomingId), "off")
    })
  })

  it("a match that is not watchlisted cannot receive a reminder", async () => {
    await withRollback(async (tx) => {
      await tx.userWatchlistMatch.deleteMany({ where: { userId: user, matchId: upcomingId } })
      await assert.rejects(setWatchlistReminder(tx, user, upcomingId, "5m"), (error: unknown) => error instanceof ReminderError && /watchlist/.test(error.message))
      // OFF on a non-watchlisted match is a no-op, not an error, and creates no row.
      assert.equal(await setWatchlistReminder(tx, user, upcomingId, "off"), "off")
      assert.equal(await tx.userWatchlistMatch.count({ where: { userId: user, matchId: upcomingId } }), 0)
    })
  })

  it("live and finished matches cannot have a future reminder", async () => {
    await withRollback(async (tx) => {
      for (const [matchId, pattern] of [[liveId, /already started/], [finishedId, /already finished/]] as const) {
        await tx.userWatchlistMatch.upsert({ where: { userId_matchId: { userId: user, matchId } }, create: { userId: user, matchId }, update: {} })
        await assert.rejects(setWatchlistReminder(tx, user, matchId, "at_start"), (error: unknown) => error instanceof ReminderError && pattern.test(error.message))
        assert.equal(await stored(tx, matchId), "off")
        // Clearing is still allowed so a stale preference can be removed.
        assert.equal(await setWatchlistReminder(tx, user, matchId, "off"), "off")
      }
    })
  })

  it("unknown users, matches and values are rejected", async () => {
    await withRollback(async (tx) => {
      await assert.rejects(setWatchlistReminder(tx, "no-such-user", upcomingId, "5m"), /user does not exist/)
      await assert.rejects(setWatchlistReminder(tx, user, "no-such-match", "5m"), /match does not exist/)
      await assert.rejects(setWatchlistReminder(tx, user, upcomingId, "2h"), /Unknown reminder/)
    })
  })
})
