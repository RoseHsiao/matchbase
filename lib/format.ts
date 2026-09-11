/** Single locale for every date and number label, so UI language stays consistent. */
export const LOCALE = "en-US"

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

const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  year: "numeric",
})

const shortDateFormatter = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
})

const weekdayOnlyFormatter = new Intl.DateTimeFormat(LOCALE, {
  weekday: "short",
})

function toDate(value: Date | string): Date {
  return typeof value === "string" ? new Date(value) : value
}

export function startOfDay(value: Date | string): Date {
  const date = new Date(toDate(value))
  date.setHours(0, 0, 0, 0)
  return date
}

export function addDays(value: Date | string, days: number): Date {
  const date = new Date(toDate(value))
  date.setDate(date.getDate() + days)
  return date
}

/** Local calendar day key such as "2026-09-10", for grouping and lookups. */
export function dayKey(value: Date | string): string {
  const date = toDate(value)
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
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

const monthYearFormatter = new Intl.DateTimeFormat(LOCALE, {
  month: "long",
  year: "numeric",
})

/** "September 2026" */
export function formatMonthYear(value: Date | string): string {
  return monthYearFormatter.format(toDate(value))
}

/** Short weekday labels, Sunday first, in the app locale. */
export function weekdayLabels(): string[] {
  const sunday = new Date(2023, 0, 1) // a known Sunday
  return Array.from({ length: 7 }, (_, i) => weekdayOnlyFormatter.format(addDays(sunday, i)))
}

/** Parse "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" as local time. Undefined when invalid. */
export function parseLocalDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value)
  if (!match) return undefined
  const [, y, m, d, hh = "0", mm = "0"] = match
  const date = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm))
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** "Sep 12, 2026" */
export function formatDate(value: Date | string): string {
  return dateFormatter.format(toDate(value))
}

/** "Sep 12, 2026 · 7:30 PM" */
export function formatDateTime(value: Date | string): string {
  return `${formatDate(value)} · ${formatTime(value)}`
}

/** "just now", "12 min ago", "3 h ago", "2 d ago" */
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

/** Value for an <input type="datetime-local">, in local time. */
export function toDateTimeLocal(value: Date | string): string {
  const date = toDate(value)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
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
