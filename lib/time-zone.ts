/**
 * The presentation time zone and the calendar arithmetic that goes with it.
 *
 * MatchBase stores every instant in UTC and shows every instant in one zone,
 * `PRESENTATION_TIME_ZONE`. That choice has to be explicit in code, because
 * the alternative is the *runtime's* zone, and the runtime differs: a Vercel
 * function runs in UTC while a visitor's browser runs wherever they are. Any
 * formatter or day boundary that leans on the runtime zone therefore renders
 * one string on the server and a different one in the browser, which React
 * reports as a hydration mismatch (error #418) and which made Production show
 * UTC kick-off times at first paint (Phase 9.4).
 *
 * So: nothing in the application may call `Date#getHours`, `setHours`,
 * `getDate`, `getMonth`, `getFullYear` or an unpinned `Intl.DateTimeFormat`
 * for presentation. Everything goes through this module and lib/format.ts,
 * which pin the zone and are therefore identical on both sides.
 *
 * This module is pure and dependency-free, so client components, server
 * components, the seed and the tests all share one implementation and one
 * zone literal. `DEMO_TIME_ZONE` in lib/demo-clock.ts is an alias of the
 * constant below, not a second source of truth.
 */

/** The single zone the product presents and groups days in. */
export const PRESENTATION_TIME_ZONE = "Asia/Taipei"

/** Wall-clock fields in a specific time zone. `month` is 1-12. */
export type ZonedDateTime = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

/** A calendar day in a specific time zone, with no time of day. */
export type CalendarDate = Pick<ZonedDateTime, "year" | "month" | "day">

const partFormatters = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let cached = partFormatters.get(timeZone)
  if (!cached) {
    cached = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    partFormatters.set(timeZone, cached)
  }
  return cached
}

/** The wall-clock fields of `instant` in `timeZone`. */
export function instantToZoned(instant: Date, timeZone: string = PRESENTATION_TIME_ZONE): ZonedDateTime {
  const fields: Record<string, number> = {}
  for (const part of partsFormatter(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") fields[part.type] = Number(part.value)
  }
  return { year: fields.year, month: fields.month, day: fields.day, hour: fields.hour, minute: fields.minute }
}

/** Milliseconds the zone is ahead of UTC at `instant` (Asia/Taipei: 8 h, no DST). */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const z = instantToZoned(instant, timeZone)
  const seconds = Number(partsFormatter(timeZone).formatToParts(instant).find((p) => p.type === "second")?.value ?? 0)
  const asUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, seconds)
  return asUtc - instant.getTime()
}

/**
 * The instant at which a wall clock in `timeZone` reads `zoned`. Correct
 * across DST transitions for zones that have them; Asia/Taipei does not.
 */
export function zonedToInstant(zoned: ZonedDateTime, timeZone: string = PRESENTATION_TIME_ZONE): Date {
  const guess = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, 0, 0)
  const first = guess - zoneOffsetMs(new Date(guess), timeZone)
  const second = guess - zoneOffsetMs(new Date(first), timeZone)
  return new Date(second)
}

/** Add whole days to a calendar date, letting Date.UTC normalise month and year. */
export function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() }
}

/** Add whole months to a calendar date, clamping the day to the target month's length. */
export function addCalendarMonths(date: CalendarDate, months: number): CalendarDate {
  const target = new Date(Date.UTC(date.year, date.month - 1 + months, 1))
  const year = target.getUTCFullYear()
  const month = target.getUTCMonth() + 1
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { year, month, day: Math.min(date.day, lastDay) }
}

/** Whole days from `from` to `to`, counted on the calendar, so no rounding and no DST drift. */
export function calendarDayDifference(from: CalendarDate, to: CalendarDate): number {
  const a = Date.UTC(from.year, from.month - 1, from.day)
  const b = Date.UTC(to.year, to.month - 1, to.day)
  return Math.round((b - a) / 86_400_000)
}

/** Day of the week for a calendar date, 0 = Sunday. Independent of any zone. */
export function calendarWeekday(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()
}

/** "2026-09-10" for a calendar date. */
export function calendarDateKey(date: CalendarDate): string {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`
}

export function sameCalendarDate(a: CalendarDate, b: CalendarDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day
}
