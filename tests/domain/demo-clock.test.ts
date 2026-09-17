import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  ANCHOR_STEP_MINUTES,
  createDemoClock,
  DEMO_TIME_ZONE,
  instantToZoned,
  resolveDemoAnchor,
  zonedToInstant,
} from "../../lib/demo-clock"

/** 2026-09-14 12:00 Asia/Taipei, the anchor the original fixed seed used. */
const ANCHOR = new Date("2026-09-14T04:00:00.000Z")

describe("createDemoClock", () => {
  test("a fixed anchor produces the expected instants", () => {
    const clock = createDemoClock({ anchor: ANCHOR })
    assert.equal(clock.timeZone, DEMO_TIME_ZONE)
    assert.equal(clock.fromAnchor(150).toISOString(), "2026-09-14T06:30:00.000Z")
    assert.equal(clock.fromAnchor(-67).toISOString(), "2026-09-14T02:53:00.000Z")
    // Tomorrow 21:00 Taipei is 13:00 UTC.
    assert.equal(clock.at(1, 21, 0).toISOString(), "2026-09-15T13:00:00.000Z")
    assert.equal(clock.at(-1, 14).toISOString(), "2026-09-13T06:00:00.000Z")
    assert.deepEqual(clock.anchorDate(), { year: 2026, month: 9, day: 14 })
  })

  test("the anchor's calendar day is taken in the demo zone, not UTC", () => {
    // 23:30 UTC on the 14th is already 07:30 on the 15th in Taipei.
    const clock = createDemoClock({ anchor: new Date("2026-09-14T23:30:00.000Z") })
    assert.deepEqual(clock.anchorDate(), { year: 2026, month: 9, day: 15 })
    assert.equal(clock.at(0, 12).toISOString(), "2026-09-15T04:00:00.000Z")
  })

  test("day offsets cross month boundaries", () => {
    const clock = createDemoClock({ anchor: new Date("2026-01-31T04:00:00.000Z") })
    assert.equal(clock.at(1, 9).toISOString(), "2026-02-01T01:00:00.000Z")
    assert.equal(clock.at(-31, 9).toISOString(), "2025-12-31T01:00:00.000Z")
  })

  test("day offsets cross year boundaries", () => {
    const clock = createDemoClock({ anchor: new Date("2026-12-31T04:00:00.000Z") })
    assert.equal(clock.at(1, 0).toISOString(), "2026-12-31T16:00:00.000Z")
    assert.equal(clock.at(2, 8, 30).toISOString(), "2027-01-02T00:30:00.000Z")
  })

  test("leap day", () => {
    const clock = createDemoClock({ anchor: new Date("2028-02-28T04:00:00.000Z") })
    assert.equal(clock.at(1, 12).toISOString(), "2028-02-29T04:00:00.000Z")
    assert.equal(clock.at(2, 12).toISOString(), "2028-03-01T04:00:00.000Z")
  })

  test("the zone is explicit: the same wall-clock time is a different instant in another zone", () => {
    const taipei = createDemoClock({ anchor: ANCHOR, timeZone: "Asia/Taipei" })
    const utc = createDemoClock({ anchor: ANCHOR, timeZone: "UTC" })
    const newYork = createDemoClock({ anchor: ANCHOR, timeZone: "America/New_York" })
    assert.equal(taipei.at(1, 21).toISOString(), "2026-09-15T13:00:00.000Z")
    assert.equal(utc.at(1, 21).toISOString(), "2026-09-15T21:00:00.000Z")
    assert.equal(newYork.at(1, 21).toISOString(), "2026-09-16T01:00:00.000Z") // EDT, UTC-4
  })

  test("the clock is frozen and does not depend on the wall clock", () => {
    const a = createDemoClock({ anchor: ANCHOR })
    const b = createDemoClock({ anchor: ANCHOR })
    assert.ok(Object.isFrozen(a))
    assert.equal(a.at(3, 16, 30).getTime(), b.at(3, 16, 30).getTime())
    assert.equal(a.fromAnchor(90).getTime(), b.fromAnchor(90).getTime())
  })

  test("rejects an invalid anchor or zone", () => {
    assert.throws(() => createDemoClock({ anchor: new Date("nope") }), /not a valid date/)
    assert.throws(() => createDemoClock({ anchor: ANCHOR, timeZone: "Mars/Olympus" }))
  })
})

describe("zone conversion", () => {
  test("round-trips through Asia/Taipei", () => {
    const zoned = { year: 2026, month: 9, day: 14, hour: 12, minute: 0 }
    const instant = zonedToInstant(zoned, "Asia/Taipei")
    assert.equal(instant.toISOString(), "2026-09-14T04:00:00.000Z")
    assert.deepEqual(instantToZoned(instant, "Asia/Taipei"), zoned)
  })

  test("handles a DST zone on both sides of the change", () => {
    // Europe/Berlin: CEST (+2) in July, CET (+1) in December.
    assert.equal(zonedToInstant({ year: 2026, month: 7, day: 4, hour: 15, minute: 0 }, "Europe/Berlin").toISOString(), "2026-07-04T13:00:00.000Z")
    assert.equal(zonedToInstant({ year: 2026, month: 12, day: 4, hour: 15, minute: 0 }, "Europe/Berlin").toISOString(), "2026-12-04T14:00:00.000Z")
  })
})

describe("resolveDemoAnchor", () => {
  const now = new Date("2026-11-03T09:47:12.345Z")

  test("without DEMO_ANCHOR: the current instant floored to the half hour", () => {
    assert.equal(resolveDemoAnchor({}, now).toISOString(), "2026-11-03T09:30:00.000Z")
    assert.equal(resolveDemoAnchor({ DEMO_ANCHOR: "  " }, now).toISOString(), "2026-11-03T09:30:00.000Z")
    assert.equal(ANCHOR_STEP_MINUTES, 30)
  })

  test("a date pins the anchor to noon in the demo zone", () => {
    assert.equal(resolveDemoAnchor({ DEMO_ANCHOR: "2026-09-14" }, now).toISOString(), "2026-09-14T04:00:00.000Z")
  })

  test("a wall-clock time is read in the demo zone", () => {
    assert.equal(resolveDemoAnchor({ DEMO_ANCHOR: "2026-09-14T19:30" }, now).toISOString(), "2026-09-14T11:30:00.000Z")
  })

  test("an instant with a zone is taken as is", () => {
    assert.equal(resolveDemoAnchor({ DEMO_ANCHOR: "2026-09-14T04:00:00Z" }, now).toISOString(), "2026-09-14T04:00:00.000Z")
    assert.equal(resolveDemoAnchor({ DEMO_ANCHOR: "2026-09-14T12:00:00+08:00" }, now).toISOString(), "2026-09-14T04:00:00.000Z")
  })

  test("anything else is rejected rather than silently read as local time", () => {
    assert.throws(() => resolveDemoAnchor({ DEMO_ANCHOR: "2026-09-14T04:00:00" }, now), /not a date/)
    assert.throws(() => resolveDemoAnchor({ DEMO_ANCHOR: "tomorrow" }, now), /not a date/)
  })
})
