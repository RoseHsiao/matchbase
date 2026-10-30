import { getReminderAt, reminderOption } from "@/lib/reminders"
import type { MatchStatus, WatchlistReminder } from "@/lib/data/types"

/**
 * Delivery rules for match reminders (Phase 11), pure so every boundary is
 * unit-tested with fixed instants. Times are absolute UTC instants; the due
 * instant is `getReminderAt(startsAt, reminder)`, the same arithmetic the UI
 * shows ("Reminder at …"), so what is promised and what is sent agree. No
 * time zone is involved in deciding *when*; the presentation zone is used
 * only to *write* the time in the email (lib/format.ts).
 */

export { MATCH_REMINDER_KIND } from "@/lib/mail/templates/match-reminder"

/** A reminder is still worth sending up to this long after it was due; later it is skipped, never sent late. */
export const MAX_LATENESS_MS = 15 * 60_000
/** Attempts per notification, the first one included. */
export const MAX_ATTEMPTS = 3
/** How long a claimed row stays reserved for one run before another run may reclaim it. */
export const CLAIM_LEASE_MS = 5 * 60_000
/** Rows claimed at a time; a run claims chunk after chunk while its time budget allows. */
export const CLAIM_CHUNK = 10
/** Upper bound of rows one run handles, whatever the budget. */
export const MAX_PER_RUN = 200
/**
 * Wall-clock budget for the claim-and-send loop. The route's maxDuration is 60 s; planning,
 * sweeping and the response need the rest.
 */
export const RUN_BUDGET_MS = 40_000
/**
 * The longest one claimed row can take: the Resend transport's timeout (10 s) plus the database
 * reads and the settle write. A chunk is claimed only if every row in it could take this long and
 * still finish inside the budget, so a run never holds claims it cannot complete.
 */
export const WORST_CASE_SEND_MS = 12_000
/** Due watchlist rows planned per pass, earliest due first; the rest are planned by the next run. */
export const PLAN_LIMIT = 500

/** How many rows the next chunk may claim, given the time left in the run. */
export function affordableClaims(remainingMs: number, worstCaseSendMs: number = WORST_CASE_SEND_MS): number {
  return Math.max(0, Math.floor(remainingMs / worstCaseSendMs))
}

export type SkipReason = "not-due" | "delivery-unconfirmed" | "late" | "match-not-upcoming" | "match-started" | "rescheduled" | "reminder-changed" | "not-watchlisted" | "opted-out" | "email-unconfirmed" | "attempts-exhausted"

export type Eligibility = { deliverable: true; dueAt: Date } | { deliverable: false; reason: SkipReason }

/**
 * Whether a reminder may be sent at `now`:
 * - the match is UPCOMING (stored status; transitions belong to the sync);
 * - it is due (`now >= dueAt`) and not more than MAX_LATENESS_MS late;
 * - an offset reminder ("15 min before") is never sent once the match has
 *   started; an "at start" reminder is, within the same lateness window.
 */
export function reminderEligibility(input: { status: MatchStatus; startsAt: Date; reminder: WatchlistReminder; now: Date }): Eligibility {
  const dueAt = getReminderAt(input.startsAt, input.reminder)
  if (!dueAt) return { deliverable: false, reason: "reminder-changed" }
  if (input.status !== "upcoming") return { deliverable: false, reason: "match-not-upcoming" }
  const now = input.now.getTime()
  if (now < dueAt.getTime()) return { deliverable: false, reason: "not-due" }
  if (now - dueAt.getTime() > MAX_LATENESS_MS) return { deliverable: false, reason: "late" }
  if (reminderOption(input.reminder).offsetMs !== 0 && now >= input.startsAt.getTime()) return { deliverable: false, reason: "match-started" }
  return { deliverable: true, dueAt }
}

/** Backoff before attempt `attempts + 1`: 1, 2, 4 … minutes, never past the lateness window anyway. */
export function nextAttemptAt(attempts: number, now: Date): Date {
  return new Date(now.getTime() + Math.min(2 ** Math.max(attempts - 1, 0), 8) * 60_000)
}

/** The start of the UTC day `now` falls in: the daily cap counts sends from here. */
export function capDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}
