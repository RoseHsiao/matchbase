import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { after, before, describe, it } from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"

import { createUserStateOps, EMPTY_FOLLOWS } from "../../lib/data/repositories/user-state-ops"
import { PrismaClient } from "../../lib/generated/prisma/client"

/**
 * Two-user isolation of personal state against the real database. Every
 * case runs inside a transaction that is rolled back, so the two users it
 * creates never persist. Skipped when no database URL is configured.
 */

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file)
}
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

class Rollback extends Error {}

describeDb("user-state isolation between two users (database)", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) })
  let teamId = ""
  let playerId = ""
  let leagueId = ""
  let seasonId = ""
  /** Set per transaction: the test creates its own upcoming match (see withTwoUsers). */
  let upcomingId = ""

  before(async () => {
    // Only catalogue rows that do not age are read from the seed. The upcoming
    // match is created inside each rolled-back transaction instead, because a
    // seeded "upcoming" fixture becomes past as the calendar moves and used to
    // fail this suite weeks after a seed (docs/demo-data-and-time.md).
    ;[teamId, playerId, leagueId, seasonId] = await Promise.all([
      prisma.team.findFirstOrThrow({ orderBy: { id: "asc" }, select: { id: true } }).then((r) => r.id),
      prisma.player.findFirstOrThrow({ orderBy: { id: "asc" }, select: { id: true } }).then((r) => r.id),
      prisma.season.findFirstOrThrow({ orderBy: { id: "asc" }, select: { id: true, leagueId: true } }).then((r) => { leagueId = r.leagueId; return r.id }),
    ]).then(([team, player, season]) => [team, player, leagueId, season])
  })

  after(async () => {
    await prisma.$disconnect()
  })

  async function withTwoUsers(work: (ops: ReturnType<typeof createUserStateOps>, a: string, b: string) => Promise<void>) {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await prisma
      .$transaction(async (tx) => {
        const [a, b, match] = await Promise.all([
          tx.user.create({ data: { email: `isolation-a-${stamp}@example.test`, name: "A" }, select: { id: true } }),
          tx.user.create({ data: { email: `isolation-b-${stamp}@example.test`, name: "B" }, select: { id: true } }),
          tx.match.create({
            data: { leagueId, seasonId, startsAt: new Date(Date.now() + 2 * 86_400_000), status: "UPCOMING", stage: `isolation-${stamp}` },
            select: { id: true },
          }),
        ])
        upcomingId = match.id
        await work(createUserStateOps(tx), a.id, b.id)
        throw new Rollback()
      }, { timeout: 30_000, maxWait: 10_000 })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error
      })
  }

  it("new users start empty and their role defaults to USER", async () => {
    await withTwoUsers(async (ops, a, b) => {
      assert.deepEqual(await ops.getFollows(a), EMPTY_FOLLOWS)
      assert.deepEqual(await ops.getFollows(b), EMPTY_FOLLOWS)
    })
    const stamp = `${Date.now()}`
    await prisma
      .$transaction(async (tx) => {
        const created = await tx.user.create({ data: { email: `role-${stamp}@example.test`, name: "R" }, select: { role: true, emailVerified: true } })
        assert.equal(created.role, "USER")
        assert.equal(created.emailVerified, false)
        throw new Rollback()
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error
      })
  })

  it("follows and watchlist rows belong to the user who wrote them", async () => {
    await withTwoUsers(async (ops, a, b) => {
      await ops.followTeam(a, teamId)
      await ops.followPlayer(a, playerId)
      await ops.followLeague(a, leagueId)
      await ops.addToWatchlist(a, upcomingId)
      await ops.setWatchlistReminder(a, upcomingId, "15m")

      const mine = await ops.getFollows(a)
      assert.deepEqual(mine.teamIds, [teamId])
      assert.deepEqual(mine.playerIds, [playerId])
      assert.deepEqual(mine.leagueIds, [leagueId])
      assert.deepEqual(mine.watchlistMatchIds, [upcomingId])
      assert.deepEqual(mine.watchlistReminders, { [upcomingId]: "15m" })

      assert.deepEqual(await ops.getFollows(b), EMPTY_FOLLOWS)
    })
  })

  it("one user's writes cannot remove or change another user's rows", async () => {
    await withTwoUsers(async (ops, a, b) => {
      await ops.followTeam(a, teamId)
      await ops.addToWatchlist(a, upcomingId)
      await ops.setWatchlistReminder(a, upcomingId, "1h")

      // B "unfollows" and "unsaves" the same targets: no-ops on B, untouched for A.
      await ops.unfollowTeam(b, teamId)
      await ops.removeFromWatchlist(b, upcomingId)
      await assert.rejects(() => ops.setWatchlistReminder(b, upcomingId, "5m"), /watchlist/i)

      const mine = await ops.getFollows(a)
      assert.deepEqual(mine.teamIds, [teamId])
      assert.deepEqual(mine.watchlistMatchIds, [upcomingId])
      assert.equal(mine.watchlistReminders[upcomingId], "1h")
      assert.deepEqual(await ops.getFollows(b), EMPTY_FOLLOWS)
    })
  })

  it("both users can hold the same target independently", async () => {
    await withTwoUsers(async (ops, a, b) => {
      await ops.addToWatchlist(a, upcomingId)
      await ops.addToWatchlist(b, upcomingId)
      await ops.setWatchlistReminder(a, upcomingId, "5m")
      await ops.setWatchlistReminder(b, upcomingId, "1d")
      assert.equal((await ops.getFollows(a)).watchlistReminders[upcomingId], "5m")
      assert.equal((await ops.getFollows(b)).watchlistReminders[upcomingId], "1d")
      await ops.removeFromWatchlist(a, upcomingId)
      assert.deepEqual((await ops.getFollows(a)).watchlistMatchIds, [])
      assert.deepEqual((await ops.getFollows(b)).watchlistMatchIds, [upcomingId])
    })
  })

  it("an unknown user id cannot write anything", async () => {
    // One violation per transaction: PostgreSQL aborts the transaction after the first failed statement.
    await withTwoUsers(async (ops) => {
      await assert.rejects(() => ops.followTeam("no-such-user", teamId), /does not exist/)
    })
    await withTwoUsers(async (ops) => {
      await assert.rejects(() => ops.addToWatchlist("no-such-user", upcomingId), /does not exist/)
    })
  })
})
