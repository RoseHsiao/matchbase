import type { MatchStatus as DomainMatchStatus, WatchlistReminder } from "@/lib/data/types"
import { Prisma, type NotificationStatus, type PrismaClient } from "@/lib/generated/prisma/client"
import { describeMailResult, type Mailer, type MailResult } from "@/lib/mail/mailer"
import { matchReminderEmail } from "@/lib/mail/templates/match-reminder"
import { affordableClaims, CLAIM_CHUNK, CLAIM_LEASE_MS, capDayStart, MATCH_REMINDER_KIND, MAX_ATTEMPTS, MAX_LATENESS_MS, MAX_PER_RUN, nextAttemptAt, PLAN_LIMIT, reminderEligibility, RUN_BUDGET_MS, WORST_CASE_SEND_MS, type SkipReason } from "@/lib/notifications/policy"
import { getReminderAt, reminderOption } from "@/lib/reminders"

/**
 * The match-reminder delivery pipeline (Phase 11, docs/notifications.md).
 * One run, triggered by the authenticated cron route, does four things:
 *
 * 1. **Plan.** Watchlist rows with a reminder, whose user opted in and has a
 *    confirmed address, and whose UPCOMING match makes the reminder due now
 *    (within the lateness window), become NotificationDelivery rows.
 *    `createMany(skipDuplicates)` on the unique (user, match, kind, dueAt)
 *    key makes this idempotent under repeated and concurrent runs.
 * 2. **Sweep.** PENDING/RETRY rows that are now too late end SKIPPED("late");
 *    nothing is ever sent late.
 * 3. **Claim.** `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`
 *    moves due rows to SENDING with a lease and counts the attempt.
 *    Concurrent runs claim disjoint rows. A row whose lease expired (a run
 *    died mid-send) is claimable again; the daily cap limits the batch.
 * 4. **Send.** Each claimed row is re-checked against current data (still
 *    watchlisted with the same offset, same start, still opted in and
 *    confirmed, still eligible) and sent with `idempotencyKey =
 *    notification:<id>`, so a retry after an ambiguous failure (a timeout
 *    after the provider accepted) is de-duplicated by the provider. The
 *    result is written only while this run still holds the lease (fencing).
 *
 * Nothing here logs an address or content: one `describeMailResult` line per
 * send and a counts-only summary.
 */

type DbReminder = "OFF" | "AT_START" | "MIN_5" | "MIN_15" | "MIN_30" | "HOUR_1" | "DAY_1"
type DbMatchStatus = "UPCOMING" | "LIVE" | "FINISHED"

const fromDbReminder: Record<DbReminder, WatchlistReminder> = { OFF: "off", AT_START: "at_start", MIN_5: "5m", MIN_15: "15m", MIN_30: "30m", HOUR_1: "1h", DAY_1: "1d" }
const fromDbStatus: Record<DbMatchStatus, DomainMatchStatus> = { UPCOMING: "upcoming", LIVE: "live", FINISHED: "finished" }

export type DeliveryClient = Pick<PrismaClient, "$queryRaw" | "$transaction" | "userWatchlistMatch" | "notificationDelivery" | "user" | "match">

/**
 * Transaction-level advisory lock that serialises "count today's sends, then claim" across
 * concurrent runs, so two runs cannot both see the same remaining room. Any fixed 64-bit key
 * works; this one is reserved for the notification daily cap.
 */
const CAP_LOCK_KEY = 7_423_100_011

export type DeliveryDeps = {
  prisma: DeliveryClient
  mailer: Mailer
  /** Application origin for "View match" links; undefined omits the link. */
  baseURL: string | undefined
  dailyCap: number
  /** The logical instant of this run: eligibility, due times and backoff are computed from it. */
  now: Date
  log?: (line: string) => void
  /** Elapsed-time source for the run budget (milliseconds); injectable so tests control it. */
  clock?: () => number
  budgetMs?: number
  worstCaseSendMs?: number
  planLimit?: number
  /** Test seam: awaited before each cap check and claim, so a test can line concurrent runs up on purpose. */
  beforeClaim?: () => Promise<void>
}

export type DeliverySummary = {
  planned: number
  expired: number
  claimed: number
  sent: number
  retry: number
  failed: number
  suppressed: number
  skipped: number
  capReached: boolean
  /** The time budget ended the run with due rows possibly left for the next one. */
  budgetExhausted: boolean
}

/** `recovered`: the row was SENDING under an expired lease, so its last attempt's outcome is unknown. */
type Claimed = { id: string; userId: string; matchId: string; reminder: DbReminder; dueAt: Date; attempts: number; leaseUntil: Date; recovered: boolean }

const participantSelect = {
  select: { side: true, order: true, team: { select: { name: true } }, player: { select: { name: true, handle: true } } },
  orderBy: [{ side: "asc" }, { order: "asc" }],
} satisfies Prisma.Match$participantsArgs

type ParticipantRow = { side: "A" | "B"; team: { name: string } | null; player: { name: string; handle: string | null } | null }

/** "Arsenal vs Chelsea", "Sinner / Alcaraz vs …": the app's full-name title (lib/matches.ts `matchTitle`). */
function titleOf(participants: ParticipantRow[]): string {
  const side = (s: "A" | "B") =>
    participants
      .filter((p) => p.side === s)
      .map((p) => p.team?.name ?? p.player?.handle ?? p.player?.name ?? "?")
      .join(" / ")
  return `${side("A")} vs ${side("B")}`
}

/** Offsets per stored reminder value, from the one table in lib/reminders.ts. */
const OFFSETS: [DbReminder, number][] = (Object.keys(fromDbReminder) as DbReminder[])
  .filter((value) => value !== "OFF")
  .map((value) => [value, reminderOption(fromDbReminder[value]).offsetMs ?? 0])

type PlanRow = { userId: string; matchId: string; reminder: DbReminder; startsAt: Date; status: DbMatchStatus }

/**
 * Selects exactly the reminders that are due now and not yet planned, earliest due first, in SQL:
 * the due instant is computed per row (start minus the offset), so a fixed limit can never be
 * filled by rows that are not due, and rows already planned are excluded, so the same rows cannot
 * occupy the limit run after run. The eligibility rules are applied again in code below.
 */
export async function planReminders(deps: Pick<DeliveryDeps, "prisma" | "now" | "planLimit">): Promise<number> {
  const { prisma, now } = deps
  const offsetMs = Prisma.sql`(CASE w."reminder"::text ${Prisma.join(OFFSETS.map(([value, ms]) => Prisma.sql`WHEN ${value} THEN ${ms}::int`), " ")} END)`
  const rows = await prisma.$queryRaw<PlanRow[]>`
    SELECT w."userId", w."matchId", w."reminder"::text AS "reminder", m."startsAt", m."status"::text AS "status"
    FROM "UserWatchlistMatch" w
    JOIN "User" u ON u."id" = w."userId"
    JOIN "Match" m ON m."id" = w."matchId"
    CROSS JOIN LATERAL (SELECT m."startsAt" - (${offsetMs} * interval '1 millisecond') AS "due") d
    WHERE w."reminder" <> 'OFF'
      AND u."reminderEmails" AND u."emailVerified"
      AND m."status" = 'UPCOMING'
      AND d."due" <= ${now} AND d."due" >= ${new Date(now.getTime() - MAX_LATENESS_MS)}
      AND (d."due" = m."startsAt" OR m."startsAt" > ${now})
      AND NOT EXISTS (
        SELECT 1 FROM "NotificationDelivery" n
        WHERE n."userId" = w."userId" AND n."matchId" = w."matchId" AND n."kind" = ${MATCH_REMINDER_KIND} AND n."dueAt" = d."due"
      )
    ORDER BY d."due" ASC, w."userId" ASC, w."matchId" ASC
    LIMIT ${deps.planLimit ?? PLAN_LIMIT}`
  const data = rows.flatMap((row) => {
    const eligibility = reminderEligibility({ status: fromDbStatus[row.status], startsAt: row.startsAt, reminder: fromDbReminder[row.reminder], now })
    if (!eligibility.deliverable) return []
    return [{ userId: row.userId, matchId: row.matchId, kind: MATCH_REMINDER_KIND, reminder: row.reminder, dueAt: eligibility.dueAt, nextAttemptAt: now }]
  })
  if (data.length === 0) return 0
  return (await prisma.notificationDelivery.createMany({ data, skipDuplicates: true })).count
}

async function expireLate(deps: Pick<DeliveryDeps, "prisma" | "now">): Promise<number> {
  const cutoff = new Date(deps.now.getTime() - MAX_LATENESS_MS)
  return (await deps.prisma.notificationDelivery.updateMany({ where: { status: { in: ["PENDING", "RETRY"] }, dueAt: { lt: cutoff } }, data: { status: "SKIPPED", outcomeReason: "late", leaseUntil: null } })).count
}

async function claim(deps: { prisma: Pick<Prisma.TransactionClient, "$queryRaw">; now: Date }, limit: number): Promise<Claimed[]> {
  if (limit <= 0) return []
  const lease = new Date(deps.now.getTime() + CLAIM_LEASE_MS)
  // The row selection is a MATERIALIZED CTE so PostgreSQL evaluates it exactly once. As a
  // `WHERE id IN (SELECT … LIMIT n FOR UPDATE SKIP LOCKED)` subquery it may be re-evaluated per
  // outer row, and then one statement can claim more than n rows (seen in testing), which would
  // break the daily cap and the run budget.
  return deps.prisma.$queryRaw<Claimed[]>`
    WITH picked AS MATERIALIZED (
      SELECT "id", ("status" = 'SENDING') AS "recovered" FROM "NotificationDelivery"
      WHERE ("status" IN ('PENDING', 'RETRY') AND "nextAttemptAt" <= ${deps.now})
         OR ("status" = 'SENDING' AND "leaseUntil" < ${deps.now})
      ORDER BY "dueAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "NotificationDelivery" AS d
    SET "status" = 'SENDING', "leaseUntil" = ${lease}, "attempts" = d."attempts" + 1, "updatedAt" = ${deps.now}
    FROM picked
    WHERE d."id" = picked."id"
    RETURNING d."id", d."userId", d."matchId", d."reminder"::text AS "reminder", d."dueAt", d."attempts", d."leaseUntil", picked."recovered"`
}

/**
 * The daily cap, enforced atomically: under the advisory lock, count what today already used
 * (rows SENT today, plus rows SENDING that were claimed today, whatever their lease, because a
 * stale claim may already have been delivered), then claim at most the remaining room. Another
 * run waits on the lock and then sees these claims as SENDING, so concurrent runs cannot exceed
 * the cap. The lock is held only for the count and the claim, never during a send.
 */
async function claimWithinCap(deps: DeliveryDeps, limit: number): Promise<{ claimed: Claimed[]; capReached: boolean }> {
  const dayStart = capDayStart(deps.now)
  return deps.prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CAP_LOCK_KEY}::bigint)`
      const used = await tx.notificationDelivery.count({ where: { OR: [{ status: "SENT", sentAt: { gte: dayStart } }, { status: "SENDING", updatedAt: { gte: dayStart } }] } })
      const room = Math.max(0, deps.dailyCap - used)
      if (room === 0) return { claimed: [], capReached: true }
      const claimed = await claim({ prisma: tx, now: deps.now }, Math.min(limit, room))
      return { claimed, capReached: claimed.length === room }
    },
    { timeout: 15_000, maxWait: 10_000 }
  )
}

/** Writes an outcome only if this run still holds the claim; a reclaimed row belongs to the other run. */
async function settle(deps: Pick<DeliveryDeps, "prisma">, row: Claimed, data: Prisma.NotificationDeliveryUpdateManyMutationInput): Promise<boolean> {
  const result = await deps.prisma.notificationDelivery.updateMany({ where: { id: row.id, status: "SENDING", leaseUntil: row.leaseUntil }, data })
  return result.count === 1
}

function skip(reason: SkipReason): Prisma.NotificationDeliveryUpdateManyMutationInput {
  return { status: "SKIPPED", outcomeReason: reason, leaseUntil: null }
}

function outcomeOf(result: MailResult, attempts: number, now: Date): { data: Prisma.NotificationDeliveryUpdateManyMutationInput; counter: keyof Pick<DeliverySummary, "sent" | "retry" | "failed" | "suppressed" | "skipped"> } {
  switch (result.status) {
    case "sent":
      return { data: { status: "SENT", sentAt: now, providerMessageId: result.providerMessageId ?? null, leaseUntil: null, lastErrorCategory: null }, counter: "sent" }
    case "suppressed":
      return { data: { status: "SUPPRESSED", outcomeReason: result.reason, leaseUntil: null }, counter: "suppressed" }
    case "disabled":
      return { data: { status: "FAILED", outcomeReason: "mail-disabled", leaseUntil: null }, counter: "failed" }
    case "failed": {
      // The provider already holds a request for this notification (same idempotency key): it may have been
      // delivered, so it is never marked FAILED and never resent under a new key.
      if (result.category === "idempotency-conflict" || (result.category === "in-progress" && attempts >= MAX_ATTEMPTS)) {
        return { data: { status: "SKIPPED", outcomeReason: "provider-already-processed", lastErrorCategory: result.category, leaseUntil: null }, counter: "skipped" }
      }
      const status: NotificationStatus = result.retryable && attempts < MAX_ATTEMPTS ? "RETRY" : "FAILED"
      return {
        data: { status, lastErrorCategory: result.category, leaseUntil: null, nextAttemptAt: nextAttemptAt(attempts, now), outcomeReason: status === "FAILED" ? (result.retryable ? "attempts-exhausted" : "permanent-failure") : null },
        counter: status === "RETRY" ? "retry" : "failed",
      }
    }
  }
}

export async function runReminderDelivery(deps: DeliveryDeps): Promise<DeliverySummary> {
  const log = deps.log ?? ((line: string) => console.info(line))
  const summary: DeliverySummary = { planned: 0, expired: 0, claimed: 0, sent: 0, retry: 0, failed: 0, suppressed: 0, skipped: 0, capReached: false, budgetExhausted: false }
  const clock = deps.clock ?? (() => Date.now())
  const started = clock()
  const budgetMs = deps.budgetMs ?? RUN_BUDGET_MS
  const worstCaseSendMs = deps.worstCaseSendMs ?? WORST_CASE_SEND_MS

  summary.planned = await planReminders(deps)
  summary.expired = await expireLate(deps)

  // Claim a chunk only when every row in it could hit the transport timeout and still finish inside the budget,
  // and only within the daily cap, which claimWithinCap enforces atomically across concurrent runs.
  while (summary.claimed < MAX_PER_RUN) {
    const affordable = affordableClaims(budgetMs - (clock() - started), worstCaseSendMs)
    if (affordable === 0) {
      summary.budgetExhausted = true
      break
    }
    await deps.beforeClaim?.()
    const { claimed, capReached } = await claimWithinCap(deps, Math.min(CLAIM_CHUNK, affordable, MAX_PER_RUN - summary.claimed))
    summary.claimed += claimed.length
    if (claimed.length > 0) await sendClaimed(deps, claimed, summary, log)
    if (capReached) {
      summary.capReached = true
      break
    }
    if (claimed.length === 0) break
  }

  log(`[notifications] run planned=${summary.planned} expired=${summary.expired} claimed=${summary.claimed} sent=${summary.sent} retry=${summary.retry} failed=${summary.failed} suppressed=${summary.suppressed} skipped=${summary.skipped}${summary.capReached ? " cap-reached" : ""}${summary.budgetExhausted ? " budget-exhausted" : ""}`)
  return summary
}

async function sendClaimed(deps: DeliveryDeps, claimed: Claimed[], summary: DeliverySummary, log: (line: string) => void): Promise<void> {
  for (const row of claimed) {
    // Only a recovered row can be past the attempt limit: its last attempt may have been delivered,
    // so it is not a confirmed failure. It ends SKIPPED(delivery-unconfirmed) and is not sent again.
    if (row.attempts > MAX_ATTEMPTS) {
      if (await settle(deps, row, { status: "SKIPPED", outcomeReason: "delivery-unconfirmed", lastErrorCategory: "lease-expired", leaseUntil: null })) summary.skipped++
      continue
    }
    const [entry, user, match] = await Promise.all([
      deps.prisma.userWatchlistMatch.findUnique({ where: { userId_matchId: { userId: row.userId, matchId: row.matchId } }, select: { reminder: true } }),
      deps.prisma.user.findUnique({ where: { id: row.userId }, select: { email: true, name: true, emailVerified: true, reminderEmails: true } }),
      deps.prisma.match.findUnique({ where: { id: row.matchId }, select: { startsAt: true, status: true, league: { select: { name: true } }, participants: participantSelect } }),
    ])
    let reason: SkipReason | null = null
    if (!entry) reason = "not-watchlisted"
    else if (entry.reminder !== row.reminder) reason = "reminder-changed"
    else if (!user?.reminderEmails) reason = "opted-out"
    else if (!user.emailVerified) reason = "email-unconfirmed"
    else if (!match) reason = "not-watchlisted"
    else if (getReminderAt(match.startsAt, fromDbReminder[row.reminder])?.getTime() !== row.dueAt.getTime()) reason = "rescheduled"
    else {
      const eligibility = reminderEligibility({ status: fromDbStatus[match.status], startsAt: match.startsAt, reminder: fromDbReminder[row.reminder], now: deps.now })
      if (!eligibility.deliverable) reason = eligibility.reason
    }
    if (reason || !user || !match) {
      // A recovered row that is no longer sendable may still have been delivered by its last attempt.
      const data = row.recovered ? { ...skip("delivery-unconfirmed"), lastErrorCategory: "lease-expired" } : skip(reason ?? "not-watchlisted")
      if (await settle(deps, row, data)) summary.skipped++
      continue
    }

    const message = matchReminderEmail({
      to: user.email,
      name: user.name,
      matchTitle: titleOf(match.participants),
      leagueName: match.league.name,
      startsAt: match.startsAt,
      reminder: fromDbReminder[row.reminder] as Exclude<WatchlistReminder, "off">,
      matchUrl: deps.baseURL ? `${deps.baseURL.replace(/\/+$/, "")}/matches/${encodeURIComponent(row.matchId)}` : null,
    })
    let result: MailResult
    try {
      result = await deps.mailer.send({ ...message, idempotencyKey: `notification:${row.id}` })
    } catch {
      result = { status: "failed", transport: deps.mailer.transport, category: "transport-error", retryable: false }
    }
    log(describeMailResult(message.kind, result))
    const outcome = outcomeOf(result, row.attempts, deps.now)
    if (await settle(deps, row, outcome.data)) summary[outcome.counter]++
  }
}
