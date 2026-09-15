import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { REMINDER_OPTIONS, REMINDER_VALUES, getReminderAt, isReminderAvailable, isWatchlistReminder, reminderLabel } from "../../lib/reminders"
import { validateReminderChange } from "../../lib/watchlist/reminder-rules"

// 2026-09-20 19:30 in a +08:00 zone, i.e. 11:30Z. Arithmetic is zone-free.
const START = "2026-09-20T11:30:00.000Z"
const startMs = Date.parse(START)

describe("getReminderAt", () => {
  it("OFF has no reminder instant", () => {
    assert.equal(getReminderAt(START, "off"), null)
  })

  it("AT_START is the match start itself", () => {
    assert.equal(getReminderAt(START, "at_start")?.toISOString(), START)
  })

  const cases: [Parameters<typeof getReminderAt>[1], number][] = [
    ["5m", 5 * 60_000],
    ["15m", 15 * 60_000],
    ["30m", 30 * 60_000],
    ["1h", 60 * 60_000],
    ["1d", 24 * 60 * 60_000],
  ]
  for (const [reminder, offset] of cases) {
    it(`${reminder} fires ${offset / 60_000} minutes before the start`, () => {
      assert.equal(getReminderAt(START, reminder)?.getTime(), startMs - offset)
    })
  }

  it("15 minutes before 19:30 is 19:15 and 1 hour before is 18:30 in the same zone", () => {
    const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false })
    assert.equal(fmt.format(getReminderAt(START, "15m") ?? new Date(0)), "19:15")
    assert.equal(fmt.format(getReminderAt(START, "1h") ?? new Date(0)), "18:30")
  })

  it("accepts a Date as well as an ISO string and rejects garbage", () => {
    assert.equal(getReminderAt(new Date(START), "5m")?.getTime(), startMs - 5 * 60_000)
    assert.throws(() => getReminderAt("not a date", "5m"), /Invalid match start/)
  })
})

describe("reminder options", () => {
  it("offers exactly the supported values in menu order", () => {
    assert.deepEqual(REMINDER_VALUES, ["off", "at_start", "5m", "15m", "30m", "1h", "1d"])
    assert.deepEqual(REMINDER_OPTIONS.map((o) => o.label), ["Off", "At start time", "5 min before", "15 min before", "30 min before", "1 hour before", "1 day before"])
  })

  it("labels and type guard", () => {
    assert.equal(reminderLabel("15m"), "15 min before")
    assert.equal(isWatchlistReminder("1d"), true)
    assert.equal(isWatchlistReminder("2h"), false)
    assert.equal(isWatchlistReminder(15), false)
  })

  it("is only available for upcoming matches", () => {
    assert.equal(isReminderAvailable("upcoming"), true)
    assert.equal(isReminderAvailable("live"), false)
    assert.equal(isReminderAvailable("finished"), false)
  })
})

describe("validateReminderChange", () => {
  it("allows any option on a watchlisted upcoming match", () => {
    for (const reminder of REMINDER_VALUES) {
      assert.deepEqual(validateReminderChange({ reminder, matchStatus: "upcoming", watchlisted: true }), { ok: true, reminder })
    }
  })

  it("OFF is always allowed, even when not watchlisted or after the match", () => {
    assert.equal(validateReminderChange({ reminder: "off", matchStatus: "finished", watchlisted: false }).ok, true)
    assert.equal(validateReminderChange({ reminder: "off", matchStatus: "live", watchlisted: true }).ok, true)
  })

  it("rejects a reminder on a match that is not watchlisted", () => {
    const result = validateReminderChange({ reminder: "15m", matchStatus: "upcoming", watchlisted: false })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /watchlist/)
  })

  it("rejects a future reminder on a live or finished match", () => {
    const live = validateReminderChange({ reminder: "at_start", matchStatus: "live", watchlisted: true })
    const finished = validateReminderChange({ reminder: "1d", matchStatus: "finished", watchlisted: true })
    assert.equal(live.ok, false)
    assert.equal(finished.ok, false)
    if (!live.ok) assert.match(live.error, /already started/)
    if (!finished.ok) assert.match(finished.error, /already finished/)
  })

  it("rejects unknown values", () => {
    assert.equal(validateReminderChange({ reminder: "2h", matchStatus: "upcoming", watchlisted: true }).ok, false)
    assert.equal(validateReminderChange({ reminder: null, matchStatus: "upcoming", watchlisted: true }).ok, false)
  })
})
