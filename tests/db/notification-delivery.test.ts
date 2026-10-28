import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { after, before, beforeEach, describe, it } from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"

import { PrismaClient } from "../../lib/generated/prisma/client"
import type { MailMessage, MailResult } from "../../lib/mail/mailer"
import { createCaptureMailer } from "../../lib/mail/transports/capture"
import { planReminders, runReminderDelivery } from "../../lib/notifications/delivery"
import { MAX_ATTEMPTS } from "../../lib/notifications/policy"
import { readReminderEmailSettings, setReminderEmails } from "../../lib/notifications/preferences-ops"

/**
 * The reminder pipeline against the development database. Concurrency needs
 * separately committed rows, so this suite creates its own users and matches
 * (far in the future, with a synthetic `now`) and deletes them afterwards;
 * deliveries cascade. Only users created here opt in to reminder emails, so
 * no other row in the database is planned or claimed. Mail goes to a capture
 * mailer; global fetch is replaced.
 */

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file)
}
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const realFetch = globalThis.fetch
globalThis.fetch = (() => {
  throw new Error("A notification test tried to reach the network.")
}) as typeof fetch

const MIN = 60_000
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
// Far from any seeded fixture: 400 days ahead, on a whole minute.
const BASE_TIME = Math.floor((Date.now() + 400 * 86_400_000) / MIN) * MIN
const BASE_URL = "https://matchbase.example"

describeDb("reminder delivery pipeline (database)", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }), transactionOptions: { timeout: 30_000, maxWait: 10_000 } })
  const capture = createCaptureMailer({})
  const logs: string[] = []
  let leagueId = ""
  let seasonId = ""
  let teams: string[] = []
  let caseNo = 0

  before(async () => {
    const season = await prisma.season.findFirstOrThrow({ orderBy: { id: "asc" }, select: { id: true, leagueId: true } })
    ;[leagueId, seasonId] = [season.leagueId, season.id]
    teams = (await prisma.team.findMany({ where: { leagueId }, orderBy: { id: "asc" }, take: 2, select: { id: true } })).map((t) => t.id)
    if (teams.length < 2) teams = (await prisma.team.findMany({ orderBy: { id: "asc" }, take: 2, select: { id: true } })).map((t) => t.id)
  })

  beforeEach(() => {
    capture.clear()
    capture.respondWith({ status: "sent", transport: "capture" })
    logs.length = 0
  })

  after(async () => {
    globalThis.fetch = realFetch
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${stamp}@example.test` } } })
    await prisma.match.deleteMany({ where: { stage: { startsWith: `notify-${stamp}` } } })
    await prisma.$disconnect()
  })

  /** A fresh opted-in, confirmed user with one saved match starting `startOffsetMs` after a case-specific base. */
  async function scenario(options: { reminder?: "AT_START" | "MIN_15" | "HOUR_1"; confirmed?: boolean; optedIn?: boolean; status?: "UPCOMING" | "LIVE" } = {}) {
    const n = ++caseNo
    const startsAt = new Date(BASE_TIME + n * 3 * 86_400_000)
    const user = await prisma.user.create({ data: { email: `notify-${n}-${stamp}@example.test`, name: `Fan ${n}`, emailVerified: options.confirmed ?? true, reminderEmails: options.optedIn ?? true }, select: { id: true, email: true } })
    const match = await prisma.match.create({
      data: { leagueId, seasonId, startsAt, status: options.status ?? "UPCOMING", stage: `notify-${stamp}-${n}`, participants: { create: [{ side: "A", order: 1, teamId: teams[0] }, { side: "B", order: 1, teamId: teams[1] }] } },
      select: { id: true },
    })
    await prisma.userWatchlistMatch.create({ data: { userId: user.id, matchId: match.id, reminder: options.reminder ?? "MIN_15" } })
    const offset = { AT_START: 0, MIN_15: 15 * MIN, HOUR_1: 60 * MIN }[options.reminder ?? "MIN_15"]
    const dueAt = new Date(startsAt.getTime() - offset)
    return { user, matchId: match.id, startsAt, dueAt }
  }

  const deps = (now: Date, extra: Partial<Parameters<typeof runReminderDelivery>[0]> = {}) => ({ prisma, mailer: capture, baseURL: BASE_URL, dailyCap: 100, now, log: (line: string) => void logs.push(line), ...extra })
  const rowsOf = (userId: string) => prisma.notificationDelivery.findMany({ where: { userId }, orderBy: { createdAt: "asc" } })

  it("sends one reminder at its due time, with a match link and an idempotency key, and records it", async () => {
    const { user, matchId, dueAt } = await scenario()
    const early = await runReminderDelivery(deps(new Date(dueAt.getTime() - MIN)))
    assert.equal(early.planned, 0, "nothing before it is due")
    const summary = await runReminderDelivery(deps(dueAt))
    assert.equal(summary.sent, 1)
    const [row] = await rowsOf(user.id)
    assert.equal(row.status, "SENT")
    assert.equal(row.attempts, 1)
    assert.deepEqual(row.sentAt, dueAt)
    const message = capture.messages.find((m) => m.to === user.email)
    assert.ok(message)
    assert.equal(message.idempotencyKey, `notification:${row.id}`)
    assert.ok(message.text.includes(`${BASE_URL}/matches/${matchId}`))
    for (const line of logs) assert.ok(!line.includes(user.email), line)
    assert.equal((await runReminderDelivery(deps(new Date(dueAt.getTime() + MIN)))).sent, 0, "never twice")
  })

  it("planning is idempotent under repeated and concurrent runs", async () => {
    const { user, dueAt } = await scenario()
    const counts = await Promise.all([planReminders({ prisma, now: dueAt }), planReminders({ prisma, now: dueAt }), planReminders({ prisma, now: dueAt })])
    assert.equal(counts.reduce((a, b) => a + b, 0), 1)
    assert.equal((await rowsOf(user.id)).length, 1)
  })

  it("concurrent delivery runs send each reminder exactly once", async () => {
    const { user, dueAt } = await scenario()
    const runs = await Promise.all(Array.from({ length: 4 }, () => runReminderDelivery(deps(dueAt))))
    assert.equal(runs.reduce((total, r) => total + r.sent, 0), 1)
    assert.equal(capture.messages.filter((m) => m.to === user.email).length, 1)
  })

  it("a transient failure is retried with backoff and the same idempotency key; attempts are bounded", async () => {
    const { user, dueAt } = await scenario()
    capture.respondWith({ status: "failed", transport: "capture", category: "timeout", retryable: true })
    const keys: string[] = []
    const recording = { ...capture, transport: capture.transport, send: async (m: MailMessage): Promise<MailResult> => (keys.push(m.idempotencyKey ?? ""), capture.send(m)) }
    assert.equal((await runReminderDelivery(deps(dueAt, { mailer: recording }))).retry, 1)
    let [row] = await rowsOf(user.id)
    assert.equal(row.status, "RETRY")
    assert.equal(row.lastErrorCategory, "timeout")
    assert.equal((await runReminderDelivery(deps(new Date(dueAt.getTime() + 30_000), { mailer: recording }))).claimed, 0, "not before the backoff")
    assert.equal((await runReminderDelivery(deps(new Date(dueAt.getTime() + MIN), { mailer: recording }))).retry, 1)
    assert.equal((await runReminderDelivery(deps(new Date(dueAt.getTime() + 3 * MIN), { mailer: recording }))).failed, 1, `gives up after ${MAX_ATTEMPTS} attempts`)
    ;[row] = await rowsOf(user.id)
    assert.equal(row.status, "FAILED")
    assert.equal(row.attempts, MAX_ATTEMPTS)
    assert.equal(row.outcomeReason, "attempts-exhausted")
    assert.equal(new Set(keys).size, 1, "every attempt used the same idempotency key")
    assert.equal(keys.length, MAX_ATTEMPTS)
  })

  it("a retried send that succeeds ends SENT; a permanent failure ends FAILED at once; a suppressed recipient ends SUPPRESSED", async () => {
    const a = await scenario()
    capture.respondWith({ status: "failed", transport: "capture", category: "network", retryable: true })
    await runReminderDelivery(deps(a.dueAt))
    capture.respondWith({ status: "sent", transport: "capture" })
    await runReminderDelivery(deps(new Date(a.dueAt.getTime() + MIN)))
    assert.equal((await rowsOf(a.user.id))[0].status, "SENT")

    const b = await scenario()
    capture.respondWith({ status: "failed", transport: "capture", category: "auth-config", retryable: false, httpStatus: 403 })
    await runReminderDelivery(deps(b.dueAt))
    const [failed] = await rowsOf(b.user.id)
    assert.deepEqual([failed.status, failed.outcomeReason, failed.attempts], ["FAILED", "permanent-failure", 1])

    const c = await scenario()
    capture.respondWith({ status: "suppressed", transport: "capture", reason: "recipient-not-allowlisted" })
    await runReminderDelivery(deps(c.dueAt))
    assert.equal((await rowsOf(c.user.id))[0].status, "SUPPRESSED")
  })

  it("an abandoned claim is reclaimed after its lease, and a late result from the first run cannot overwrite the second", async () => {
    const { user, dueAt } = await scenario()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const keys: string[] = []
    const slow = { transport: capture.transport, send: async (m: MailMessage): Promise<MailResult> => (keys.push(m.idempotencyKey ?? ""), await gate, { status: "failed", transport: "capture", category: "timeout", retryable: true }) }
    const first = runReminderDelivery(deps(dueAt, { mailer: slow }))
    // Wait until the first run holds the claim.
    for (let i = 0; i < 100 && (await rowsOf(user.id))[0]?.status !== "SENDING"; i++) await new Promise((r) => setTimeout(r, 50))
    const second = await runReminderDelivery(deps(new Date(dueAt.getTime() + 6 * MIN)))
    assert.equal(second.sent, 1, "the expired lease was reclaimed and sent")
    release()
    const late = await first
    assert.equal(late.retry + late.failed + late.sent, 0, "the first run's result was fenced out")
    const [row] = await rowsOf(user.id)
    assert.deepEqual([row.status, row.attempts], ["SENT", 2])
    assert.equal(capture.messages.find((m) => m.to === user.email)?.idempotencyKey, keys[0], "both attempts carried the same key, so the provider de-duplicates")
  })

  it("re-checks eligibility at send time: rescheduled, offset changed, opted out, unconfirmed, started", async () => {
    const cases = [
      { label: "rescheduled", change: (s: Awaited<ReturnType<typeof scenario>>) => prisma.match.update({ where: { id: s.matchId }, data: { startsAt: new Date(s.startsAt.getTime() + 60 * MIN) } }) },
      { label: "reminder-changed", change: (s: Awaited<ReturnType<typeof scenario>>) => prisma.userWatchlistMatch.update({ where: { userId_matchId: { userId: s.user.id, matchId: s.matchId } }, data: { reminder: "MIN_5" } }) },
      { label: "opted-out", change: (s: Awaited<ReturnType<typeof scenario>>) => prisma.user.update({ where: { id: s.user.id }, data: { reminderEmails: false } }) },
      { label: "email-unconfirmed", change: (s: Awaited<ReturnType<typeof scenario>>) => prisma.user.update({ where: { id: s.user.id }, data: { emailVerified: false } }) },
      { label: "match-not-upcoming", change: (s: Awaited<ReturnType<typeof scenario>>) => prisma.match.update({ where: { id: s.matchId }, data: { status: "LIVE" } }) },
      { label: "not-watchlisted", change: (s: Awaited<ReturnType<typeof scenario>>) => prisma.userWatchlistMatch.delete({ where: { userId_matchId: { userId: s.user.id, matchId: s.matchId } } }) },
    ]
    for (const { label, change } of cases) {
      const s = await scenario()
      await planReminders({ prisma, now: s.dueAt })
      await change(s)
      const summary = await runReminderDelivery(deps(s.dueAt))
      assert.equal(summary.sent, 0, label)
      const [row] = await rowsOf(s.user.id)
      assert.deepEqual([row.status, row.outcomeReason], ["SKIPPED", label], label)
    }
    assert.equal(capture.messages.length, 0)
  })

  it("never plans for live matches, unconfirmed or opted-out users, and never sends late", async () => {
    for (const options of [{ status: "LIVE" as const }, { confirmed: false }, { optedIn: false }]) {
      const s = await scenario(options)
      assert.equal(await planReminders({ prisma, now: s.dueAt }), 0, JSON.stringify(options))
    }
    const late = await scenario()
    assert.equal(await planReminders({ prisma, now: new Date(late.dueAt.getTime() + 16 * MIN) }), 0, "too late to plan")
    const stale = await scenario()
    await planReminders({ prisma, now: stale.dueAt })
    const summary = await runReminderDelivery(deps(new Date(stale.dueAt.getTime() + 16 * MIN)))
    assert.equal(summary.expired, 1)
    assert.deepEqual(((await rowsOf(stale.user.id))[0]).outcomeReason, "late")
    assert.equal(capture.messages.length, 0)
  })

  it("an at-start reminder goes out at kick-off", async () => {
    const s = await scenario({ reminder: "AT_START" })
    assert.equal((await runReminderDelivery(deps(new Date(s.startsAt.getTime() + 2 * MIN)))).sent, 1)
    assert.match(capture.messages[0].subject, /is starting now$/)
  })

  it("the daily cap limits sends; the rest wait and are skipped if they become late", async () => {
    const [a, b] = [await scenario({ reminder: "HOUR_1" }), await scenario({ reminder: "HOUR_1" })]
    // Line both up at one instant: move b's match so that both are due together.
    await prisma.match.update({ where: { id: b.matchId }, data: { startsAt: a.startsAt } })
    const cap = await prisma.notificationDelivery.count({ where: { status: "SENT", sentAt: { gte: new Date(Date.UTC(a.dueAt.getUTCFullYear(), a.dueAt.getUTCMonth(), a.dueAt.getUTCDate())) } } })
    const summary = await runReminderDelivery(deps(a.dueAt, { dailyCap: cap + 1 }))
    assert.equal(summary.sent, 1)
    const next = await runReminderDelivery(deps(new Date(a.dueAt.getTime() + MIN), { dailyCap: cap + 1 }))
    assert.equal(next.capReached, true)
    assert.equal(next.claimed, 0)
  })

  it("one user's preference and mail never touch another user", async () => {
    const a = await scenario()
    const b = await scenario({ optedIn: false })
    await prisma.match.update({ where: { id: b.matchId }, data: { startsAt: a.startsAt } })
    await runReminderDelivery(deps(a.dueAt))
    assert.deepEqual(capture.messages.map((m) => m.to), [a.user.email])
    assert.ok(!capture.messages[0].text.includes(b.user.email))

    assert.deepEqual(await setReminderEmails(prisma, b.user.id, true, true), { ok: true, enabled: true })
    assert.equal((await readReminderEmailSettings(prisma, a.user.id))?.enabled, true, "A unchanged")
    assert.deepEqual(await setReminderEmails(prisma, a.user.id, false, true), { ok: true, enabled: false })
    assert.equal((await readReminderEmailSettings(prisma, b.user.id))?.enabled, true, "B unchanged by A")
  })

  it("the preference refuses to turn on without mail or a confirmed address, and always turns off", async () => {
    const s = await scenario({ confirmed: false, optedIn: false })
    assert.deepEqual(await setReminderEmails(prisma, s.user.id, true, true), { ok: false, error: "Confirm your email address first." })
    assert.deepEqual(await setReminderEmails(prisma, s.user.id, true, false), { ok: false, error: "Email reminders aren't available on this deployment." })
    assert.deepEqual(await setReminderEmails(prisma, s.user.id, "yes", true), { ok: false, error: "Invalid setting." })
    assert.deepEqual(await setReminderEmails(prisma, s.user.id, false, false), { ok: true, enabled: false })
  })

  it("stores delivery metadata only", async () => {
    const s = await scenario()
    await runReminderDelivery(deps(s.dueAt))
    const [row] = await rowsOf(s.user.id)
    const serialized = JSON.stringify(row)
    assert.ok(!serialized.includes(s.user.email) && !serialized.includes("Fan "), "no address or name in the row")
  })
})
