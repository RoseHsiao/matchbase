import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { after, before, beforeEach, describe, it } from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"

import { PrismaClient } from "../../lib/generated/prisma/client"
import type { MailMessage, MailResult } from "../../lib/mail/mailer"
import { createCaptureMailer } from "../../lib/mail/transports/capture"
import { planReminders, runReminderDelivery } from "../../lib/notifications/delivery"
import { MAX_ATTEMPTS } from "../../lib/notifications/policy"

/** A fresh, otherwise unused instant for cases that arrange several reminders around one moment. */
let windowNo = 0
const freshWindow = () => new Date(BASE_TIME + 200 * 86_400_000 + ++windowNo * 3 * 86_400_000)
import { handleCronNotifications } from "../../lib/api/cron-notifications"
import { readReminderEmailSettings, reminderEmailsAvailable, setReminderEmails } from "../../lib/notifications/preferences-ops"

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
    // A league no sync test touches (they sync basketball, tennis and the EPL), so the committed rows this suite
    // creates for the length of its run never overlap a parallel sync test's data. Falls back to any season.
    const season =
      (await prisma.season.findFirst({ where: { leagueId: "lec" }, select: { id: true, leagueId: true } })) ??
      (await prisma.season.findFirstOrThrow({ orderBy: { id: "asc" }, select: { id: true, leagueId: true } }))
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
  async function scenario(options: { reminder?: "AT_START" | "MIN_15" | "HOUR_1"; confirmed?: boolean; optedIn?: boolean; status?: "UPCOMING" | "LIVE"; startsAt?: Date } = {}) {
    const n = ++caseNo
    const startsAt = options.startsAt ?? new Date(BASE_TIME + n * 3 * 86_400_000)
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
    const sentTo = capture.messages.map((m) => (m.to === a.user.email ? "a" : m.to === b.user.email ? "b" : "other"))
    assert.equal(summary.sent, 1, JSON.stringify({ cap, summary, sentTo }))
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

  it("claims only what the time budget can finish; the rest stays PENDING, unclaimed, for the next run", async () => {
    const start = freshWindow()
    const rows = [await scenario({ startsAt: start }), await scenario({ startsAt: start }), await scenario({ startsAt: start })]
    const dueAt = rows[0].dueAt
    let elapsed = 0
    const slow = { transport: capture.transport, send: async (m: MailMessage): Promise<MailResult> => ((elapsed += 6_000), capture.send(m)) }
    // Budget 15 s, worst case 10 s per send: one row is affordable; after its 6 s send only 9 s remain, which affords none.
    const summary = await runReminderDelivery(deps(dueAt, { mailer: slow, clock: () => elapsed, budgetMs: 15_000, worstCaseSendMs: 10_000 }))
    assert.equal(summary.planned, 3)
    assert.equal(summary.claimed, 1, "never more claims than the budget can finish")
    assert.equal(summary.sent, 1)
    assert.equal(summary.budgetExhausted, true)
    const states = (await Promise.all(rows.map((r) => rowsOf(r.user.id)))).map(([row]) => [row.status, row.attempts])
    assert.deepEqual(states.filter(([status]) => status === "PENDING"), [["PENDING", 0], ["PENDING", 0]], "unsent rows were never claimed, so no attempt was spent")
    const next = await runReminderDelivery(deps(new Date(dueAt.getTime() + MIN)))
    assert.equal(next.sent, 2, "the next run delivers the rest inside the lateness window")
  })

  it("plans due reminders earliest-due first under the plan limit, never crowded out by already-planned or not-due rows", async () => {
    const now = freshWindow()
    // Due 10 min ago, 5 min ago, and now; plus one not due for another 5 minutes.
    const a = await scenario({ reminder: "MIN_15", startsAt: new Date(now.getTime() + 5 * MIN) })
    const b = await scenario({ reminder: "MIN_15", startsAt: new Date(now.getTime() + 10 * MIN) })
    const c = await scenario({ reminder: "HOUR_1", startsAt: new Date(now.getTime() + 60 * MIN) })
    const notDue = await scenario({ reminder: "MIN_15", startsAt: new Date(now.getTime() + 20 * MIN) })
    assert.equal(await planReminders({ prisma, now, planLimit: 2 }), 2)
    const planned = async () => (await prisma.notificationDelivery.findMany({ where: { userId: { in: [a, b, c, notDue].map((x) => x.user.id) } }, select: { userId: true } })).map((r) => r.userId)
    assert.deepEqual((await planned()).sort(), [a.user.id, b.user.id].sort(), "the two earliest-due reminders first")
    assert.equal(await planReminders({ prisma, now, planLimit: 2 }), 1, "already-planned rows no longer take the limit")
    assert.deepEqual((await planned()).sort(), [a.user.id, b.user.id, c.user.id].sort())
    assert.equal(await planReminders({ prisma, now, planLimit: 2 }), 0)
    assert.ok(!(await planned()).includes(notDue.user.id), "a reminder that is not due is never planned")
  })

  it("a Resend payload conflict (409 invalid_idempotent_request) is recorded as already processed, never FAILED, never resent", async () => {
    const s = await scenario()
    capture.respondWith({ status: "failed", transport: "capture", category: "idempotency-conflict", retryable: false, httpStatus: 409 })
    const summary = await runReminderDelivery(deps(s.dueAt))
    assert.equal(summary.failed, 0)
    const [row] = await rowsOf(s.user.id)
    assert.deepEqual([row.status, row.outcomeReason, row.lastErrorCategory], ["SKIPPED", "provider-already-processed", "idempotency-conflict"])
    capture.respondWith({ status: "sent", transport: "capture" })
    assert.equal((await runReminderDelivery(deps(new Date(s.dueAt.getTime() + 2 * MIN)))).claimed, 0, "terminal: nothing is resent")
  })

  it("a request still in progress (409) is retried with the same key and ends SENT, or ends already-processed when attempts run out, never FAILED", async () => {
    const keys: string[] = []
    const recording = { transport: capture.transport, send: async (m: MailMessage): Promise<MailResult> => (keys.push(m.idempotencyKey ?? ""), capture.send(m)) }
    const a = await scenario()
    capture.respondWith({ status: "failed", transport: "capture", category: "in-progress", retryable: true, httpStatus: 409 })
    assert.equal((await runReminderDelivery(deps(a.dueAt, { mailer: recording }))).retry, 1)
    capture.respondWith({ status: "sent", transport: "capture" })
    await runReminderDelivery(deps(new Date(a.dueAt.getTime() + MIN), { mailer: recording }))
    assert.equal((await rowsOf(a.user.id))[0].status, "SENT")
    assert.equal(new Set(keys).size, 1, "the retry reused the key, so the provider returns the original outcome")

    const b = await scenario()
    capture.respondWith({ status: "failed", transport: "capture", category: "in-progress", retryable: true, httpStatus: 409 })
    for (const offset of [0, MIN, 3 * MIN]) await runReminderDelivery(deps(new Date(b.dueAt.getTime() + offset)))
    const [row] = await rowsOf(b.user.id)
    assert.deepEqual([row.status, row.outcomeReason, row.attempts], ["SKIPPED", "provider-already-processed", MAX_ATTEMPTS])
  })

  describe("the reminder-email switch (AUTH_EMAIL_VERIFICATION_ENABLED)", () => {
    const CRON = "notify-test-cron-secret-0123456789"
    const ON = { CRON_SECRET: CRON, NODE_ENV: "development", MAIL_TRANSPORT: "dev-outbox", MAIL_FROM: "dev@example.com", AUTH_EMAIL_VERIFICATION_ENABLED: "true" }
    const OFF = { ...ON, AUTH_EMAIL_VERIFICATION_ENABLED: undefined }
    const cron = (env: Record<string, string | undefined>, now: Date) =>
      handleCronNotifications(new Request("http://localhost/api/cron/notifications", { headers: { authorization: `Bearer ${CRON}` } }), {
        env,
        now: () => now,
        run: (at) => runReminderDelivery(deps(at)),
      })

    it("switched off: an already opted-in user gets no email from a cron invocation, and nothing is planned", async () => {
      const s = await scenario()
      assert.equal(reminderEmailsAvailable(OFF), false)
      const response = await cron(OFF, s.dueAt)
      assert.deepEqual(await response.json(), { ok: true, skipped: "reminder-email-unavailable" })
      assert.equal(capture.messages.length, 0)
      assert.equal((await rowsOf(s.user.id)).length, 0)
    })

    it("switched off: an opted-in user can still opt out, and an opted-out user cannot opt in", async () => {
      const optedIn = await scenario()
      assert.deepEqual(await setReminderEmails(prisma, optedIn.user.id, false, reminderEmailsAvailable(OFF)), { ok: true, enabled: false })
      assert.equal((await readReminderEmailSettings(prisma, optedIn.user.id))?.enabled, false)
      const optedOut = await scenario({ optedIn: false })
      assert.deepEqual(await setReminderEmails(prisma, optedOut.user.id, true, reminderEmailsAvailable(OFF)), { ok: false, error: "Email reminders aren't available on this deployment." })
      assert.equal((await readReminderEmailSettings(prisma, optedOut.user.id))?.enabled, false)
    })

    it("switched on: the same invocation delivers as before", async () => {
      const s = await scenario()
      const body = (await (await cron(ON, s.dueAt)).json()) as { ok: boolean; sent?: number }
      assert.equal(body.ok, true)
      assert.equal(body.sent, 1)
      assert.deepEqual(capture.messages.map((m) => m.to), [s.user.email])
      assert.deepEqual(await setReminderEmails(prisma, s.user.id, true, reminderEmailsAvailable(ON)), { ok: true, enabled: true })
    })
  })

  it("the daily cap holds when several runs start together", async () => {
    const start = freshWindow()
    const rows = []
    for (let i = 0; i < 5; i++) rows.push(await scenario({ startsAt: start }))
    const dueAt = rows[0].dueAt
    // Plan first, so every concurrent run competes only for claims.
    await planReminders({ prisma, now: dueAt })
    const dayStart = new Date(Date.UTC(dueAt.getUTCFullYear(), dueAt.getUTCMonth(), dueAt.getUTCDate()))
    const already = await prisma.notificationDelivery.count({ where: { status: "SENT", sentAt: { gte: dayStart } } })
    // A barrier lines all four runs up at the cap decision, the worst case a doubled cron delivery can produce.
    const RUNS = 4
    let arrived = 0
    let open: () => void = () => {}
    const gate = new Promise<void>((resolve) => (open = resolve))
    const barrier = async () => {
      if (++arrived === RUNS) open()
      await gate
    }
    const runs = await Promise.all(Array.from({ length: RUNS }, () => runReminderDelivery(deps(dueAt, { dailyCap: already + 2, beforeClaim: barrier }))))
    const sent = runs.reduce((total, run) => total + run.sent, 0)
    assert.equal(sent, 2, `cap of 2 exceeded by concurrent runs: ${JSON.stringify(runs.map((r) => r.sent))}`)
    assert.equal(await prisma.notificationDelivery.count({ where: { status: "SENT", sentAt: { gte: dayStart } } }), already + 2)
    const states = (await Promise.all(rows.map((r) => rowsOf(r.user.id)))).map(([row]) => row.status).sort()
    assert.deepEqual(states, ["PENDING", "PENDING", "PENDING", "SENT", "SENT"], "the rest wait, unclaimed")
  })

  describe("ambiguous outcomes after lease recovery", () => {
    /** A mailer whose send reaches the provider (recorded) and then never reports back: the worker died mid-send. */
    function dyingMailer(keys: string[]) {
      let release: () => void = () => {}
      const gate = new Promise<void>((resolve) => (release = resolve))
      return {
        release,
        mailer: { transport: capture.transport, send: async (m: MailMessage): Promise<MailResult> => (keys.push(m.idempotencyKey ?? ""), await gate, { status: "failed", transport: "capture", category: "timeout", retryable: true }) },
      }
    }
    async function waitForSending(userId: string, attempts: number) {
      for (let i = 0; i < 100; i++) {
        const [row] = await rowsOf(userId)
        if (row?.status === "SENDING" && row.attempts === attempts) return
        await new Promise((r) => setTimeout(r, 50))
      }
      throw new Error("the dying run never claimed the row")
    }

    it("a last attempt that may have been delivered, then worker death, lease recovery and exhaustion: SKIPPED(delivery-unconfirmed), never FAILED, never resent", async () => {
      const s = await scenario()
      const keys: string[] = []
      const recording = { transport: capture.transport, send: async (m: MailMessage): Promise<MailResult> => (keys.push(m.idempotencyKey ?? ""), capture.send(m)) }
      capture.respondWith({ status: "failed", transport: "capture", category: "timeout", retryable: true })
      await runReminderDelivery(deps(s.dueAt, { mailer: recording }))
      await runReminderDelivery(deps(new Date(s.dueAt.getTime() + MIN), { mailer: recording }))
      assert.equal((await rowsOf(s.user.id))[0].attempts, 2)

      // Attempt 3 is handed to the provider, then the worker dies before recording anything.
      const dying = dyingMailer(keys)
      const abandoned = runReminderDelivery(deps(new Date(s.dueAt.getTime() + 3 * MIN), { mailer: dying.mailer }))
      await waitForSending(s.user.id, MAX_ATTEMPTS)

      // After the 5-minute lease, a later run recovers the row with no attempts left.
      capture.respondWith({ status: "sent", transport: "capture" })
      capture.clear()
      const recovery = await runReminderDelivery(deps(new Date(s.dueAt.getTime() + 9 * MIN)))
      assert.equal(recovery.claimed, 1)
      assert.equal(recovery.failed, 0, "not reported as a confirmed failure")
      assert.equal(capture.messages.length, 0, "not sent again")

      dying.release()
      const late = await abandoned
      assert.equal(late.retry + late.failed + late.sent, 0, "the dead worker's late result is fenced out")
      const [row] = await rowsOf(s.user.id)
      assert.deepEqual([row.status, row.outcomeReason, row.lastErrorCategory, row.attempts], ["SKIPPED", "delivery-unconfirmed", "lease-expired", MAX_ATTEMPTS + 1])
      assert.equal(keys.length, MAX_ATTEMPTS)
      assert.equal(new Set(keys).size, 1, "every attempt used the same idempotency key")
    })

    it("a recovered row that has become too late is SKIPPED(delivery-unconfirmed), not reported as never sent", async () => {
      const s = await scenario()
      const keys: string[] = []
      const dying = dyingMailer(keys)
      const abandoned = runReminderDelivery(deps(s.dueAt, { mailer: dying.mailer }))
      await waitForSending(s.user.id, 1)
      const recovery = await runReminderDelivery(deps(new Date(s.dueAt.getTime() + 16 * MIN)))
      assert.equal(recovery.sent + recovery.failed, 0)
      dying.release()
      await abandoned
      const [row] = await rowsOf(s.user.id)
      assert.deepEqual([row.status, row.outcomeReason], ["SKIPPED", "delivery-unconfirmed"])
      assert.equal(keys.length, 1)
    })
  })

  it("stores delivery metadata only", async () => {
    const s = await scenario()
    await runReminderDelivery(deps(s.dueAt))
    const [row] = await rowsOf(s.user.id)
    const serialized = JSON.stringify(row)
    assert.ok(!serialized.includes(s.user.email) && !serialized.includes("Fan "), "no address or name in the row")
  })
})
