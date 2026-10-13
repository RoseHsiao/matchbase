/**
 * The demo clock: one source of truth for every time-relative demo value.
 *
 * Demo data (lib/data/mock.ts, written by prisma/seed.ts) describes a
 * timeline in *offsets* ("67 minutes before the anchor", "tomorrow at 21:00")
 * rather than instants. A `DemoClock` turns those offsets into instants from
 * one anchor, so the same timeline can be laid over any date:
 *
 * - the seed resolves the anchor from the real date (or `DEMO_ANCHOR`), so
 *   the demo stays populated as the calendar moves;
 * - tests pass a fixed anchor, so they never read the wall clock.
 *
 * Day-relative offsets are evaluated in `DEMO_TIME_ZONE`, which is an alias of
 * the application's `PRESENTATION_TIME_ZONE` (lib/time-zone.ts), so "tomorrow
 * at 21:00" means 21:00 in Taipei whatever zone the seeding machine runs in,
 * and the seeded timeline agrees with the day boundaries the UI renders.
 * Instants are UTC. The zoned calendar primitives live in lib/time-zone.ts;
 * this module only adds the anchor-relative offsets.
 *
 * Nothing here is global or mutable: a clock is a plain frozen object, and
 * `Date` is never patched. Real provider data never passes through this
 * module; it carries its own timestamps.
 */

import {
  addCalendarDays,
  instantToZoned,
  PRESENTATION_TIME_ZONE,
  zonedToInstant,
  type CalendarDate,
  type ZonedDateTime,
} from "@/lib/time-zone"

/** The zone demo offsets are evaluated in: the presentation zone, under its demo-facing name. */
export const DEMO_TIME_ZONE = PRESENTATION_TIME_ZONE

export type { ZonedDateTime }
export { instantToZoned, zonedToInstant }

export type DemoClock = {
  /** The reference instant; "now" for the demo. */
  readonly anchor: Date
  /** IANA zone in which `at` interprets days and wall-clock times. */
  readonly timeZone: string
  /** `minutes` after (negative: before) the anchor. */
  fromAnchor(minutes: number): Date
  /**
   * `dayOffset` days from the anchor's calendar day, at the given wall-clock
   * time, in `timeZone`. Offsets may cross month and year boundaries.
   */
  at(dayOffset: number, hour: number, minute?: number): Date
  /** The anchor's calendar date in `timeZone`. */
  anchorDate(): CalendarDate
}

export function createDemoClock(options: { anchor: Date; timeZone?: string }): DemoClock {
  const anchor = new Date(options.anchor.getTime())
  if (Number.isNaN(anchor.getTime())) throw new Error("Demo clock anchor is not a valid date.")
  const timeZone = options.timeZone ?? DEMO_TIME_ZONE
  // Validate the zone once; Intl throws on unknown zones.
  instantToZoned(anchor, timeZone)
  const anchorDate = () => {
    const { year, month, day } = instantToZoned(anchor, timeZone)
    return { year, month, day }
  }
  return Object.freeze({
    anchor,
    timeZone,
    fromAnchor: (minutes: number) => new Date(anchor.getTime() + minutes * 60_000),
    at: (dayOffset: number, hour: number, minute = 0) => zonedToInstant({ ...addCalendarDays(anchorDate(), dayOffset), hour, minute }, timeZone),
    anchorDate,
  })
}

/** Granularity the default anchor is floored to, so seeded kick-off times land on :00 / :30. */
export const ANCHOR_STEP_MINUTES = 30

/**
 * The anchor for a seed run. `DEMO_ANCHOR` pins it for reproducible demos:
 * - "YYYY-MM-DD"            → that day at 12:00 in `timeZone`
 * - "YYYY-MM-DDTHH:mm"      → that wall-clock time in `timeZone`
 * - any string with a zone ("…Z", "…+08:00") → that exact instant
 * Without it, `now` floored to the previous half hour.
 */
export function resolveDemoAnchor(env: Readonly<Record<string, string | undefined>>, now: Date, timeZone: string = DEMO_TIME_ZONE): Date {
  const raw = env.DEMO_ANCHOR?.trim()
  if (!raw) {
    const step = ANCHOR_STEP_MINUTES * 60_000
    return new Date(Math.floor(now.getTime() / step) * step)
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (dateOnly) {
    const [, y, m, d] = dateOnly
    return zonedToInstant({ year: Number(y), month: Number(m), day: Number(d), hour: 12, minute: 0 }, timeZone)
  }
  const wallClock = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(raw)
  if (wallClock) {
    const [, y, m, d, hh, mm] = wallClock
    return zonedToInstant({ year: Number(y), month: Number(m), day: Number(d), hour: Number(hh), minute: Number(mm) }, timeZone)
  }
  const instant = new Date(raw)
  if (Number.isNaN(instant.getTime()) || !/([zZ]|[+-]\d{2}:\d{2})$/.test(raw)) {
    throw new Error(`DEMO_ANCHOR "${raw}" is not a date (YYYY-MM-DD), a wall-clock time (YYYY-MM-DDTHH:mm), or an instant with a zone.`)
  }
  return instant
}
