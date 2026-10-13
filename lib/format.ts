import {
  addCalendarDays,
  addCalendarMonths,
  calendarDateKey,
  calendarDayDifference,
  calendarWeekday,
  instantToZoned,
  PRESENTATION_TIME_ZONE,
  sameCalendarDate,
  zonedToInstant,
  type CalendarDate,
} from "@/lib/time-zone"

/**
 * Every date, time and day boundary the UI shows, rendered in one locale and
 * one time zone.
 *
 * The zone is pinned to `PRESENTATION_TIME_ZONE` (lib/time-zone.ts) on every
 * formatter and on every piece of calendar arithmetic here. That is not a
 * stylistic choice: without it these functions read the *runtime's* zone, so
 * the server (UTC on Vercel) and the browser (wherever the visitor is)
 * produce different text for the same instant. React reports that as a
 * hydration mismatch, and until Phase 9.4 Production served UTC kick-off
 * times at first paint before the client corrected them.
 *
 * Consequences worth knowing:
 * - "Today", "Tomorrow", day grouping and the schedule window all mean the
 *   Taipei calendar day, for everyone, regardless of where they are.
 * - `startOfDay` and `addDays` return instants (UTC inside), but the boundary
 *   they pick is Taipei midnight, not the runtime's midnight.
 * - Nothing here uses `Date#getHours`, `getDate`, `getMonth`, `getFullYear`
 *   or `setHours`; those read the runtime zone and are the bug this module
 *   exists to prevent.
 */

/** Single locale for every date and number label, so UI language stays consistent. */
export const LOCALE = "en-US"

export { PRESENTATION_TIME_ZONE }

/** Every formatter pins the zone; `timeZone` is never left to the runtime. */
function formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: PRESENTATION_TIME_ZONE })
}

const timeFormatter = formatter({
  hour: "numeric",
  minute: "2-digit",
})

const weekdayFormatter = formatter({
  weekday: "short",
  month: "short",
  day: "numeric",
})

const longDateFormatter = formatter({
  weekday: "long",
  month: "long",
  day: "numeric",
})

const dateFormatter = formatter({
  month: "short",
  day: "numeric",
  year: "numeric",
})

const shortDateFormatter = formatter({
  month: "short",
  day: "numeric",
})

const weekdayOnlyFormatter = formatter({
  weekday: "short",
})

const monthYearFormatter = formatter({
  month: "long",
  year: "numeric",
})

function toDate(value: Date | string): Date {
  return typeof value === "string" ? new Date(value) : value
}

/** The Taipei calendar date an instant falls on. */
function calendarDateOf(value: Date | string): CalendarDate {
  const { year, month, day } = instantToZoned(toDate(value), PRESENTATION_TIME_ZONE)
  return { year, month, day }
}

/** The instant of 00:00 in the presentation zone on the day `value` falls on. */
export function startOfDay(value: Date | string): Date {
  return zonedToInstant({ ...calendarDateOf(value), hour: 0, minute: 0 }, PRESENTATION_TIME_ZONE)
}

/** `days` calendar days later in the presentation zone, keeping the wall-clock time of day. */
export function addDays(value: Date | string, days: number): Date {
  const zoned = instantToZoned(toDate(value), PRESENTATION_TIME_ZONE)
  const shifted = addCalendarDays(zoned, days)
  return zonedToInstant({ ...shifted, hour: zoned.hour, minute: zoned.minute }, PRESENTATION_TIME_ZONE)
}

/** The instant of 00:00 on the first day of `value`'s month, in the presentation zone. */
export function startOfMonth(value: Date | string): Date {
  const { year, month } = calendarDateOf(value)
  return zonedToInstant({ year, month, day: 1, hour: 0, minute: 0 }, PRESENTATION_TIME_ZONE)
}

/** `months` calendar months later, at 00:00 on the first of that month. */
export function addMonths(value: Date | string, months: number): Date {
  const shifted = addCalendarMonths({ ...calendarDateOf(value), day: 1 }, months)
  return zonedToInstant({ ...shifted, hour: 0, minute: 0 }, PRESENTATION_TIME_ZONE)
}

/** Calendar day key such as "2026-09-10" in the presentation zone, for grouping and lookups. */
export function dayKey(value: Date | string): string {
  return calendarDateKey(calendarDateOf(value))
}

/** Day of the month (1-31) in the presentation zone. */
export function dayOfMonth(value: Date | string): number {
  return calendarDateOf(value).day
}

/** Month number (1-12) in the presentation zone. */
export function monthNumber(value: Date | string): number {
  return calendarDateOf(value).month
}

/** Hour of the day (0-23) in the presentation zone. */
export function hourOfDay(value: Date | string): number {
  return instantToZoned(toDate(value), PRESENTATION_TIME_ZONE).hour
}

/** Minute of the hour (0-59) in the presentation zone. */
export function minuteOfHour(value: Date | string): number {
  return instantToZoned(toDate(value), PRESENTATION_TIME_ZONE).minute
}

/** Day of the week in the presentation zone, 0 = Sunday. */
export function weekdayNumber(value: Date | string): number {
  return calendarWeekday(calendarDateOf(value))
}

export function isSameDay(a: Date | string, b: Date | string): boolean {
  return sameCalendarDate(calendarDateOf(a), calendarDateOf(b))
}

/** Whole-day difference from `from` to `to` on the presentation zone's calendar. */
export function dayDifference(from: Date | string, to: Date | string): number {
  return calendarDayDifference(calendarDateOf(from), calendarDateOf(to))
}

/** "7:30 PM" */
export function formatTime(value: Date | string): string {
  return timeFormatter.format(toDate(value))
}

/** "Today", "Tomorrow", "Yesterday", or "Thu, Sep 12" */
export function formatDayLabel(
  value: Date | string,
  now: Date = new Date()
): string {
  const diff = dayDifference(now, value)
  if (diff === 0) return "Today"
  if (diff === 1) return "Tomorrow"
  if (diff === -1) return "Yesterday"
  return weekdayFormatter.format(toDate(value))
}

/** "Today · 7:30 PM" */
export function formatKickoff(
  value: Date | string,
  now: Date = new Date()
): string {
  return `${formatDayLabel(value, now)} · ${formatTime(value)}`
}

/** "September 2026" */
export function formatMonthYear(value: Date | string): string {
  return monthYearFormatter.format(toDate(value))
}

/** Short weekday labels, Sunday first, in the app locale. */
export function weekdayLabels(): string[] {
  // A known Sunday, taken at midday UTC so it is the same calendar day in every zone.
  const sunday = new Date("2023-01-01T12:00:00.000Z")
  return Array.from({ length: 7 }, (_, i) => weekdayOnlyFormatter.format(addDays(sunday, i)))
}

/**
 * Parse "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" as a wall-clock value in the
 * presentation zone, so a form round-trips through `toDateTimeLocal`
 * unchanged whatever zone the operator's machine uses. Undefined when invalid.
 */
export function parseLocalDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value)
  if (!match) return undefined
  const [, y, m, d, hh = "0", mm = "0"] = match
  const year = Number(y)
  const month = Number(m)
  const day = Number(d)
  const hour = Number(hh)
  const minute = Number(mm)
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return undefined
  const instant = zonedToInstant({ year, month, day, hour, minute }, PRESENTATION_TIME_ZONE)
  if (Number.isNaN(instant.getTime())) return undefined
  // Reject dates that do not exist, such as 2026-02-31, which would roll over.
  const back = instantToZoned(instant, PRESENTATION_TIME_ZONE)
  return back.year === year && back.month === month && back.day === day ? instant : undefined
}

/** "Sep 12, 2026" */
export function formatDate(value: Date | string): string {
  return dateFormatter.format(toDate(value))
}

/** "Sep 12, 2026 · 7:30 PM" */
export function formatDateTime(value: Date | string): string {
  return `${formatDate(value)} · ${formatTime(value)}`
}

/** "just now", "12 min ago", "3 h ago", "2 d ago". Zone-independent: a pure difference. */
export function formatRelativeTime(value: Date | string, now: Date = new Date()): string {
  const minutes = Math.round((now.getTime() - toDate(value).getTime()) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

/** "840 ms", "1.3 s", "2 m 10 s" */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes} m ${seconds} s`
}

/** Value for an <input type="datetime-local">, as wall-clock time in the presentation zone. */
export function toDateTimeLocal(value: Date | string): string {
  const { year, month, day, hour, minute } = instantToZoned(toDate(value), PRESENTATION_TIME_ZONE)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`
}

/** "Sep 12" */
export function formatShortDate(value: Date | string): string {
  return shortDateFormatter.format(toDate(value))
}

/** "Thu" */
export function formatWeekday(value: Date | string): string {
  return weekdayOnlyFormatter.format(toDate(value))
}

/** "Thursday, September 10" */
export function formatLongDate(value: Date | string): string {
  return longDateFormatter.format(toDate(value))
}
