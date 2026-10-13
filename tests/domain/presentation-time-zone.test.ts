import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { describe, it } from "node:test"

import {
  addDays,
  addMonths,
  dayDifference,
  dayKey,
  dayOfMonth,
  formatDayLabel,
  formatKickoff,
  formatMonthYear,
  hourOfDay,
  isSameDay,
  minuteOfHour,
  monthNumber,
  parseLocalDate,
  PRESENTATION_TIME_ZONE,
  startOfDay,
  startOfMonth,
  toDateTimeLocal,
  weekdayLabels,
  weekdayNumber,
} from "../../lib/format"
import { DEMO_TIME_ZONE } from "../../lib/demo-clock"
import { groupMatchesByDay } from "../../lib/schedule"
import type { MatchView } from "../../lib/data/types"

/**
 * Phase 9.4. Production rendered kick-off times in the server's zone (UTC on
 * Vercel) and then re-rendered them in the visitor's zone, which React reports
 * as hydration error #418. These tests pin the behaviour that fixes it: every
 * formatter and every day boundary must produce the same output no matter
 * which zone the process runs in, and that output must be the Asia/Taipei
 * calendar. The per-zone child processes below exercise every formatter; the
 * cases in this file import only the helpers they assert on directly.
 */

const TAIPEI_OFFSET_HOURS = 8

describe("presentation zone", () => {
  it("is Asia/Taipei, declared as a literal in exactly one module", () => {
    assert.equal(PRESENTATION_TIME_ZONE, "Asia/Taipei")
    // lib/time-zone.ts owns the literal; lib/demo-clock.ts aliases it as DEMO_TIME_ZONE.
    // Prose mentions in comments are fine; a second quoted literal is a second source of truth.
    const found = execFileSync("grep", ["-rln", '"Asia/Taipei"', "lib", "components", "app"], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .filter((f) => !f.includes("generated"))
    assert.deepEqual(found, ["lib/time-zone.ts"], `the zone literal should live in one module only; found in: ${found.join(", ")}`)
    assert.equal(DEMO_TIME_ZONE, PRESENTATION_TIME_ZONE, "the demo clock must not define its own zone")
  })
})

describe("formatting is identical in every process time zone", () => {
  // One child process per zone, each printing the same battery of values.
  const zones = ["UTC", "Asia/Taipei", "America/New_York", "Pacific/Kiritimati", "Europe/Berlin"]
  const script = `
    const f = require("./lib/format.ts")
    const instants = [
      "2026-10-13T15:59:59.000Z", // 23:59:59 Taipei
      "2026-10-13T16:00:00.000Z", // 00:00:00 Taipei, next day
      "2026-01-01T00:00:00.000Z",
      "2026-06-30T11:30:00.000Z",
      "2026-12-31T16:00:00.000Z",
    ]
    const now = new Date("2026-10-13T16:30:00.000Z")
    const out = instants.map((iso) => ({
      iso,
      time: f.formatTime(iso),
      date: f.formatDate(iso),
      dateTime: f.formatDateTime(iso),
      shortDate: f.formatShortDate(iso),
      longDate: f.formatLongDate(iso),
      weekday: f.formatWeekday(iso),
      monthYear: f.formatMonthYear(iso),
      dayLabel: f.formatDayLabel(iso, now),
      kickoff: f.formatKickoff(iso, now),
      dayKey: f.dayKey(iso),
      startOfDay: f.startOfDay(iso).toISOString(),
      plusOneDay: f.addDays(iso, 1).toISOString(),
      minusOneDay: f.addDays(iso, -1).toISOString(),
      startOfMonth: f.startOfMonth(iso).toISOString(),
      plusOneMonth: f.addMonths(iso, 1).toISOString(),
      dayOfMonth: f.dayOfMonth(iso),
      monthNumber: f.monthNumber(iso),
      weekdayNumber: f.weekdayNumber(iso),
      hour: f.hourOfDay(iso),
      minute: f.minuteOfHour(iso),
      dateTimeLocal: f.toDateTimeLocal(iso),
      diffFromNow: f.dayDifference(now, iso),
      sameDayAsNow: f.isSameDay(now, iso),
    }))
    out.push({ weekdayLabels: f.weekdayLabels() })
    out.push({ parsed: f.parseLocalDate("2026-10-14T00:00")?.toISOString(), parsedDateOnly: f.parseLocalDate("2026-10-14")?.toISOString() })
    console.log(JSON.stringify(out))
  `

  const renderIn = (tz: string): string =>
    execFileSync(process.execPath, ["--import", "tsx", "-e", script], {
      encoding: "utf8",
      env: { ...process.env, TZ: tz },
      cwd: process.cwd(),
    }).trim()

  it("produces byte-identical output in zones from UTC-5 to UTC+14", () => {
    const outputs = zones.map((tz) => ({ tz, out: renderIn(tz) }))
    const reference = outputs[0]
    for (const { tz, out } of outputs.slice(1)) {
      assert.equal(out, reference.out, `output in ${tz} differs from ${reference.tz}; this is the hydration mismatch returning`)
    }
    // And the shared output really is the Taipei calendar, not UTC.
    const values = JSON.parse(reference.out) as Record<string, unknown>[]
    assert.equal(values[0].dayKey, "2026-10-13", "23:59:59 Taipei belongs to 13 October")
    assert.equal(values[1].dayKey, "2026-10-14", "00:00:00 Taipei belongs to 14 October")
    assert.equal(values[0].time, "11:59 PM")
    assert.equal(values[1].time, "12:00 AM")
  })
})

describe("day boundaries follow the Taipei calendar", () => {
  const lastSecond = "2026-10-13T15:59:59.000Z" // 23:59:59 Taipei, 13 Oct
  const firstSecond = "2026-10-13T16:00:00.000Z" // 00:00:00 Taipei, 14 Oct

  it("midnight splits the two days", () => {
    assert.equal(dayKey(lastSecond), "2026-10-13")
    assert.equal(dayKey(firstSecond), "2026-10-14")
    assert.equal(isSameDay(lastSecond, firstSecond), false)
    assert.equal(dayDifference(lastSecond, firstSecond), 1)
  })

  it("startOfDay returns Taipei midnight, which is 16:00 UTC the day before", () => {
    assert.equal(startOfDay(lastSecond).toISOString(), "2026-10-12T16:00:00.000Z")
    assert.equal(startOfDay(firstSecond).toISOString(), "2026-10-13T16:00:00.000Z")
    // Idempotent, and the boundary itself belongs to its own day.
    assert.equal(startOfDay(startOfDay(firstSecond)).toISOString(), startOfDay(firstSecond).toISOString())
    assert.equal(dayKey(startOfDay(firstSecond)), "2026-10-14")
  })

  it("addDays keeps the wall-clock time and crosses month and year ends", () => {
    assert.equal(addDays(firstSecond, 1).toISOString(), "2026-10-14T16:00:00.000Z")
    assert.equal(dayKey(addDays("2026-10-31T13:00:00.000Z", 1)), "2026-11-01")
    assert.equal(dayKey(addDays("2026-12-31T16:00:00.000Z", 1)), "2027-01-02")
    assert.equal(hourOfDay(addDays("2026-06-30T11:30:00.000Z", 5)), 19)
    assert.equal(minuteOfHour(addDays("2026-06-30T11:30:00.000Z", 5)), 30)
  })

  it("a day window built from startOfDay and addDays spans exactly 24 hours", () => {
    const from = startOfDay(firstSecond)
    const to = addDays(from, 1)
    assert.equal(to.getTime() - from.getTime(), 86_400_000)
    assert.equal(from.toISOString(), "2026-10-13T16:00:00.000Z")
    assert.equal(to.toISOString(), "2026-10-14T16:00:00.000Z")
  })

  it("Today, Tomorrow and Yesterday are Taipei days, even near UTC midnight", () => {
    // 2026-10-13T16:30Z is already 14 Oct in Taipei.
    const now = new Date("2026-10-13T16:30:00.000Z")
    assert.equal(formatDayLabel(firstSecond, now), "Today")
    assert.equal(formatDayLabel(lastSecond, now), "Yesterday")
    assert.equal(formatDayLabel("2026-10-14T16:00:00.000Z", now), "Tomorrow")
    assert.equal(formatDayLabel("2026-10-20T04:00:00.000Z", now), "Tue, Oct 20")
    assert.equal(formatKickoff(firstSecond, now), "Today · 12:00 AM")
  })

  it("month helpers use Taipei months", () => {
    assert.equal(startOfMonth("2026-10-13T16:00:00.000Z").toISOString(), "2026-09-30T16:00:00.000Z")
    assert.equal(monthNumber("2026-09-30T16:00:00.000Z"), 10, "16:00 UTC on 30 Sep is 1 Oct in Taipei")
    assert.equal(dayOfMonth("2026-09-30T16:00:00.000Z"), 1)
    assert.equal(formatMonthYear("2026-09-30T16:00:00.000Z"), "October 2026")
    assert.equal(addMonths("2026-01-31T04:00:00.000Z", 1).toISOString(), "2026-01-31T16:00:00.000Z", "clamped to 1 Feb Taipei midnight")
    assert.equal(dayKey(addMonths("2026-01-15T04:00:00.000Z", 1)), "2026-02-01")
  })

  it("weekday numbering is the Taipei weekday, Sunday first", () => {
    assert.equal(weekdayNumber("2026-10-13T16:00:00.000Z"), 3, "14 Oct 2026 is a Wednesday in Taipei")
    assert.equal(weekdayNumber("2026-10-13T15:00:00.000Z"), 2, "still Tuesday 13 Oct in Taipei")
    assert.deepEqual(weekdayLabels(), ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"])
  })
})

describe("form round-trips in the presentation zone", () => {
  it("toDateTimeLocal and parseLocalDate are inverses", () => {
    const instant = new Date("2026-10-13T16:00:00.000Z")
    const local = toDateTimeLocal(instant)
    assert.equal(local, "2026-10-14T00:00")
    assert.equal(parseLocalDate(local)?.toISOString(), instant.toISOString())
  })
  it("a date-only value means Taipei midnight", () => {
    assert.equal(parseLocalDate("2026-10-14")?.toISOString(), "2026-10-13T16:00:00.000Z")
  })
  it("rejects malformed and non-existent values", () => {
    for (const bad of ["", "2026-10", "14/10/2026", "2026-13-01", "2026-02-31", "2026-10-14T25:00", "2026-10-14T10:70"]) {
      assert.equal(parseLocalDate(bad), undefined, bad)
    }
  })
  it("the Taipei offset is what the arithmetic implies", () => {
    const midnight = parseLocalDate("2026-10-14")!
    assert.equal((Date.parse("2026-10-14T00:00:00.000Z") - midnight.getTime()) / 3_600_000, TAIPEI_OFFSET_HOURS)
  })
})

describe("schedule grouping around Taipei midnight", () => {
  const match = (id: string, startsAt: string): MatchView =>
    ({
      id,
      leagueId: "epl",
      startsAt,
      status: "upcoming",
      participants: [],
      league: { id: "epl", name: "English Premier League", shortName: "EPL", sport: "football" },
    }) as unknown as MatchView

  it("puts 23:59 and 00:00 Taipei into different day groups, in order", () => {
    const groups = groupMatchesByDay([
      match("late", "2026-10-13T15:59:00.000Z"),
      match("early", "2026-10-13T16:01:00.000Z"),
      match("alsoLate", "2026-10-13T15:00:00.000Z"),
    ])
    assert.deepEqual(groups.map((g) => g.key), ["2026-10-13", "2026-10-14"])
    assert.deepEqual(groups[0].matches.map((m) => m.id), ["alsoLate", "late"])
    assert.deepEqual(groups[1].matches.map((m) => m.id), ["early"])
    assert.equal(groups[0].date.toISOString(), "2026-10-12T16:00:00.000Z")
    assert.equal(groups[1].date.toISOString(), "2026-10-13T16:00:00.000Z")
  })

  it("a match at 09:00 UTC and one at 23:00 UTC on the same UTC day can be different Taipei days", () => {
    const groups = groupMatchesByDay([match("a", "2026-10-13T09:00:00.000Z"), match("b", "2026-10-13T23:00:00.000Z")])
    assert.deepEqual(groups.map((g) => g.key), ["2026-10-13", "2026-10-14"])
  })
})
