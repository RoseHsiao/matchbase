import type { MatchStatus as DomainMatchStatus, WatchlistReminder } from "@/lib/data/types"
import type { NotificationStatus, Prisma, PrismaClient } from "@/lib/generated/prisma/client"
import { describeMailResult, type Mailer, type MailResult } from "@/lib/mail/mailer"
import { matchReminderEmail } from "@/lib/mail/templates/match-reminder"
import { CLAIM_BATCH, CLAIM_LEASE_MS, capDayStart, MATCH_REMINDER_KIND, MAX_ATTEMPTS, MAX_LATENESS_MS, nextAttemptAt, PLAN_HORIZON_MS, PLAN_LIMIT, reminderEligibility, type SkipReason } from "@/lib/notifications/policy"
import { getReminderAt } from "@/lib/reminders"

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

export type DeliveryClient = Pick<PrismaClient, "$queryRaw" | "userWatchlistMatch" | "notificationDelivery" | "user" | "match">

export type DeliveryDeps = {
  prisma: DeliveryClient
  mailer: Mailer
  /** Application origin for "View match" links; undefined omits the link. */
  baseURL: string | undefined
  dailyCap: number
  now: Date
  log?: (line: string) => void
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
}

type Claimed = { id: string; userId: string; matchId: string; reminder: DbReminder; dueAt: Date; attempts: number; leaseUntil: Date }

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

export async function planReminders(deps: Pick<DeliveryDeps, "prisma" | "now">): Promise<number> {
  const { prisma, now } = deps
  const rows = await prisma.userWatchlistMatch.findMany({
    where: {
      reminder: { not: "OFF" },
      user: { reminderEmails: true, emailVerified: true },
      match: { status: "UPCOMING", startsAt: { gte: new Date(now.getTime() - MAX_LATENESS_MS), lte: new Date(now.getTime() + PLAN_HORIZON_MS) } },
    },
    select: { userId: true, matchId: true, reminder: true, match: { select: { startsAt: true, status: true } } },
    take: PLAN_LIMIT,
  })
  const data = rows.flatMap((row) => {
    const eligibility = reminderEligibility({ status: fromDbStatus[row.match.status], startsAt: row.match.startsAt, reminder: fromDbReminder[row.reminder], now })
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

async function claim(deps: Pick<DeliveryDeps, "prisma" | "now">, limit: number): Promise<Claimed[]> {
  if (limit <= 0) return []
  const lease = new Date(deps.now.getTime() + CLAIM_LEASE_MS)
  return deps.prisma.$queryRaw<Claimed[]>`
    UPDATE "NotificationDelivery"
    SET "status" = 'SENDING', "leaseUntil" = ${lease}, "attempts" = "attempts" + 1, "updatedAt" = ${deps.now}
    WHERE "id" IN (
      SELECT "id" FROM "NotificationDelivery"
      WHERE ("status" IN ('PENDING', 'RETRY') AND "nextAttemptAt" <= ${deps.now})
         OR ("status" = 'SENDING' AND "leaseUntil" < ${deps.now})
      ORDER BY "dueAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "userId", "matchId", "reminder"::text AS "reminder", "dueAt", "attempts", "leaseUntil"`
}

/** Writes an outcome only if this run still holds the claim; a reclaimed row belongs to the other run. */
async function settle(deps: Pick<DeliveryDeps, "prisma">, row: Claimed, data: Prisma.NotificationDeliveryUpdateManyMutationInput): Promise<boolean> {
  const result = await deps.prisma.notificationDelivery.updateMany({ where: { id: row.id, status: "SENDING", leaseUntil: row.leaseUntil }, data })
  return result.count === 1
}

function skip(reason: SkipReason): Prisma.NotificationDeliveryUpdateManyMutationInput {
  return { status: "SKIPPED", outcomeReason: reason, leaseUntil: null }
}

function outcomeOf(result: MailResult, attempts: number, now: Date): { data: Prisma.NotificationDeliveryUpdateManyMutationInput; counter: keyof Pick<DeliverySummary, "sent" | "retry" | "failed" | "suppressed"> } {
  switch (result.status) {
    case "sent":
      return { data: { status: "SENT", sentAt: now, providerMessageId: result.providerMessageId ?? null, leaseUntil: null, lastErrorCategory: null }, counter: "sent" }
    case "suppressed":
      return { data: { status: "SUPPRESSED", outcomeReason: result.reason, leaseUntil: null }, counter: "suppressed" }
    case "disabled":
      return { data: { status: "FAILED", outcomeReason: "mail-disabled", leaseUntil: null }, counter: "failed" }
    case "failed": {
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
  const summary: DeliverySummary = { planned: 0, expired: 0, claimed: 0, sent: 0, retry: 0, failed: 0, suppressed: 0, skipped: 0, capReached: false }

  summary.planned = await planReminders(deps)
  summary.expired = await expireLate(deps)

  const sentToday = await deps.prisma.notificationDelivery.count({ where: { OR: [{ status: "SENT", sentAt: { gte: capDayStart(deps.now) } }, { status: "SENDING", leaseUntil: { gte: deps.now } }] } })
  const room = Math.max(0, deps.dailyCap - sentToday)
  summary.capReached = room === 0
  const claimed = await claim(deps, Math.min(CLAIM_BATCH, room))
  summary.claimed = claimed.length

  for (const row of claimed) {
    if (row.attempts > MAX_ATTEMPTS) {
      if (await settle(deps, row, { status: "FAILED", outcomeReason: "attempts-exhausted", leaseUntil: null })) summary.failed++
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
      if (await settle(deps, row, skip(reason ?? "not-watchlisted"))) summary.skipped++
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

  log(`[notifications] run planned=${summary.planned} expired=${summary.expired} claimed=${summary.claimed} sent=${summary.sent} retry=${summary.retry} failed=${summary.failed} suppressed=${summary.suppressed} skipped=${summary.skipped}${summary.capReached ? " cap-reached" : ""}`)
  return summary
}
