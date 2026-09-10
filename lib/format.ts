const LOCALE = "en-US"

const timeFormatter = new Intl.DateTimeFormat(LOCALE, {
  hour: "numeric",
  minute: "2-digit",
})

const weekdayFormatter = new Intl.DateTimeFormat(LOCALE, {
  weekday: "short",
  month: "short",
  day: "numeric",
})

const longDateFormatter = new Intl.DateTimeFormat(LOCALE, {
  weekday: "long",
  month: "long",
  day: "numeric",
})

function toDate(value: Date | string): Date {
  return typeof value === "string" ? new Date(value) : value
}

export function startOfDay(value: Date | string): Date {
  const date = new Date(toDate(value))
  date.setHours(0, 0, 0, 0)
  return date
}

export function isSameDay(a: Date | string, b: Date | string): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime()
}

/** Whole-day difference from `from` to `to`, ignoring time of day. */
export function dayDifference(from: Date | string, to: Date | string): number {
  const ms = startOfDay(to).getTime() - startOfDay(from).getTime()
  return Math.round(ms / 86_400_000)
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

/** "Thursday, September 10" */
export function formatLongDate(value: Date | string): string {
  return longDateFormatter.format(toDate(value))
}
