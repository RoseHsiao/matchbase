import type { MatchStatus, WatchlistReminder } from "@/lib/data/types"

/**
 * Pure reminder arithmetic and labels. No React, no data access, no time
 * zone: everything is relative to the match's absolute start instant, so
 * "15 minutes before 19:30" is 19:15 in whatever zone the instant is shown.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export type ReminderOption = {
  value: WatchlistReminder
  /** Menu label. */
  label: string
  /** Compact status label, e.g. "15 min before". */
  short: string
  /** Milliseconds before the start; null for OFF. */
  offsetMs: number | null
}

/** Every supported reminder, in menu order. */
export const REMINDER_OPTIONS: readonly ReminderOption[] = [
  { value: "off", label: "Off", short: "Off", offsetMs: null },
  { value: "at_start", label: "At start time", short: "At start time", offsetMs: 0 },
  { value: "5m", label: "5 min before", short: "5 min before", offsetMs: 5 * MINUTE },
  { value: "15m", label: "15 min before", short: "15 min before", offsetMs: 15 * MINUTE },
  { value: "30m", label: "30 min before", short: "30 min before", offsetMs: 30 * MINUTE },
  { value: "1h", label: "1 hour before", short: "1 hour before", offsetMs: HOUR },
  { value: "1d", label: "1 day before", short: "1 day before", offsetMs: DAY },
]

const byValue = new Map(REMINDER_OPTIONS.map((option) => [option.value, option]))

export const REMINDER_VALUES: readonly WatchlistReminder[] = REMINDER_OPTIONS.map((option) => option.value)

export function isWatchlistReminder(value: unknown): value is WatchlistReminder {
  return typeof value === "string" && byValue.has(value as WatchlistReminder)
}

export function reminderOption(reminder: WatchlistReminder): ReminderOption {
  const option = byValue.get(reminder)
  if (!option) throw new Error(`Unknown reminder "${reminder}".`)
  return option
}

/** "15 min before", "At start time", "Off". */
export function reminderLabel(reminder: WatchlistReminder): string {
  return reminderOption(reminder).short
}

/**
 * The instant the reminder should fire: null for OFF, the start itself for
 * AT_START, otherwise the start minus the option's offset.
 */
export function getReminderAt(matchStart: Date | string, reminder: WatchlistReminder): Date | null {
  const offset = reminderOption(reminder).offsetMs
  if (offset === null) return null
  const start = typeof matchStart === "string" ? new Date(matchStart) : matchStart
  if (Number.isNaN(start.getTime())) throw new Error(`Invalid match start "${String(matchStart)}".`)
  return new Date(start.getTime() - offset)
}

/**
 * A reminder can only be set on a match that has not started. Live and
 * finished matches accept OFF only, so clearing a stale preference always
 * works.
 */
export function isReminderAvailable(status: MatchStatus): boolean {
  return status === "upcoming"
}
