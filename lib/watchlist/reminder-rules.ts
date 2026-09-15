import type { MatchStatus, WatchlistReminder } from "@/lib/data/types"
import { isReminderAvailable, isWatchlistReminder } from "@/lib/reminders"

/**
 * The rules for changing a reminder, shared by the server action, the
 * repository and the UI so every path agrees. Pure and side-effect free.
 *
 * 1. The value must be one of the supported reminders.
 * 2. The match must be on the user's watchlist (a reminder is a property of
 *    that relationship). OFF on a non-watchlisted match is a no-op, not an error.
 * 3. Anything other than OFF needs an upcoming match: live and finished
 *    matches have already started, so a "before start" reminder is meaningless.
 */
export type ReminderRuleInput = {
  reminder: unknown
  matchStatus: MatchStatus
  watchlisted: boolean
}

export type ReminderRuleResult = { ok: true; reminder: WatchlistReminder } | { ok: false; error: string }

export function validateReminderChange(input: ReminderRuleInput): ReminderRuleResult {
  if (!isWatchlistReminder(input.reminder)) return { ok: false, error: "Unknown reminder option." }
  const reminder = input.reminder
  if (reminder === "off") return { ok: true, reminder }
  if (!input.watchlisted) return { ok: false, error: "Add the match to your watchlist before setting a reminder." }
  if (!isReminderAvailable(input.matchStatus)) {
    return {
      ok: false,
      error: input.matchStatus === "live" ? "This match has already started." : "This match has already finished.",
    }
  }
  return { ok: true, reminder }
}
