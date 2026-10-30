import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { formatKickoffWithZone } from "../../lib/format"
import { reminderSettingsState } from "../../lib/notifications/reminder-settings-view"
import { invalidMessageReason } from "../../lib/mail/mailer"
import { matchReminderEmail, reminderPhrase, safeMatchUrl } from "../../lib/mail/templates/match-reminder"
import { affordableClaims, capDayStart, MAX_LATENESS_MS, nextAttemptAt, reminderEligibility, RUN_BUDGET_MS, WORST_CASE_SEND_MS } from "../../lib/notifications/policy"
import { DEFAULT_RESEND_TIMEOUT_MS } from "../../lib/mail/transports/resend"

const START = new Date("2026-11-01T11:30:00.000Z") // 19:30 in Asia/Taipei
const MIN = 60_000
const at = (offsetMs: number) => new Date(START.getTime() + offsetMs)

describe("reminderEligibility", () => {
  it("a 15-minute reminder is deliverable from its due instant for 15 minutes, never before, never after the start", () => {
    assert.deepEqual(reminderEligibility({ status: "upcoming", startsAt: START, reminder: "15m", now: at(-15 * MIN - 1) }), { deliverable: false, reason: "not-due" })
    assert.deepEqual(reminderEligibility({ status: "upcoming", startsAt: START, reminder: "15m", now: at(-15 * MIN) }), { deliverable: true, dueAt: at(-15 * MIN) })
    assert.equal(reminderEligibility({ status: "upcoming", startsAt: START, reminder: "15m", now: at(-1) }).deliverable, true)
    assert.deepEqual(reminderEligibility({ status: "upcoming", startsAt: START, reminder: "15m", now: at(0) }), { deliverable: false, reason: "match-started" })
  })

  it("the lateness window is exact", () => {
    assert.equal(reminderEligibility({ status: "upcoming", startsAt: START, reminder: "1h", now: at(-60 * MIN + MAX_LATENESS_MS) }).deliverable, true)
    assert.deepEqual(reminderEligibility({ status: "upcoming", startsAt: START, reminder: "1h", now: at(-60 * MIN + MAX_LATENESS_MS + 1) }), { deliverable: false, reason: "late" })
  })

  it("an at-start reminder may go out at the start, within the lateness window", () => {
    assert.equal(reminderEligibility({ status: "upcoming", startsAt: START, reminder: "at_start", now: at(0) }).deliverable, true)
    assert.equal(reminderEligibility({ status: "upcoming", startsAt: START, reminder: "at_start", now: at(MAX_LATENESS_MS) }).deliverable, true)
    assert.equal(reminderEligibility({ status: "upcoming", startsAt: START, reminder: "at_start", now: at(MAX_LATENESS_MS + 1) }).deliverable, false)
  })

  it("never for a live or finished match, or with reminders off", () => {
    for (const status of ["live", "finished"] as const) assert.deepEqual(reminderEligibility({ status, startsAt: START, reminder: "at_start", now: at(0) }), { deliverable: false, reason: "match-not-upcoming" })
    assert.equal(reminderEligibility({ status: "upcoming", startsAt: START, reminder: "off", now: at(-MIN) }).deliverable, false)
  })
})

describe("time zones", () => {
  it("due instants are pure UTC arithmetic, across the presentation zone's midnight", () => {
    // 00:30 on Nov 2 in Taipei is 16:30 UTC on Nov 1; one day earlier is 16:30 UTC on Oct 31 (00:30 Nov 1 Taipei).
    const start = new Date("2026-11-01T16:30:00.000Z")
    const e = reminderEligibility({ status: "upcoming", startsAt: start, reminder: "1d", now: new Date("2026-10-31T16:30:00.000Z") })
    assert.deepEqual(e, { deliverable: true, dueAt: new Date("2026-10-31T16:30:00.000Z") })
    assert.match(formatKickoffWithZone(start), /^Mon, Nov 2, 12:30\sAM GMT\+8 \(Asia\/Taipei\)$/)
  })

  it("the email names the zone instead of implying the reader's local time", () => {
    assert.match(formatKickoffWithZone(START), /^Sun, Nov 1, 7:30\sPM GMT\+8 \(Asia\/Taipei\)$/)
  })

  it("the daily cap day is the UTC day", () => {
    assert.deepEqual(capDayStart(new Date("2026-11-01T23:59:59.999Z")), new Date("2026-11-01T00:00:00.000Z"))
  })
})

describe("run budget", () => {
  it("claims only what can finish if every send hits the transport timeout, inside the route's 60 s limit", () => {
    assert.ok(WORST_CASE_SEND_MS > DEFAULT_RESEND_TIMEOUT_MS, "the worst case covers the transport timeout")
    assert.ok(RUN_BUDGET_MS + WORST_CASE_SEND_MS <= 60_000, "a chunk claimed at the last moment still ends before maxDuration")
    assert.equal(affordableClaims(RUN_BUDGET_MS), Math.floor(RUN_BUDGET_MS / WORST_CASE_SEND_MS))
    assert.equal(affordableClaims(WORST_CASE_SEND_MS - 1), 0)
    assert.equal(affordableClaims(-5), 0)
  })
})

describe("retry backoff", () => {
  it("doubles from one minute and is capped", () => {
    const now = new Date("2026-11-01T00:00:00.000Z")
    assert.deepEqual([1, 2, 3, 4, 9].map((n) => (nextAttemptAt(n, now).getTime() - now.getTime()) / MIN), [1, 2, 4, 8, 8])
  })
})

describe("match reminder email", () => {
  const base = { to: "fan@example.com", name: "Rose", matchTitle: "Liverpool vs Manchester City", leagueName: "Premier League", startsAt: START, reminder: "15m" as const, matchUrl: "https://matchbase.example/matches/m-epl-liv-mci" }

  it("says what starts when, with the zone, one View match action, and nothing personal in the subject", () => {
    const message = matchReminderEmail(base)
    assert.equal(message.kind, "match-reminder")
    assert.equal(invalidMessageReason(message), null)
    assert.equal(message.subject, "Liverpool vs Manchester City starts in 15 minutes")
    assert.ok(message.text.includes("Liverpool vs Manchester City (Premier League) starts in 15 minutes."))
    assert.match(message.text, /Starts: Sun, Nov 1, 7:30\sPM GMT\+8 \(Asia\/Taipei\)\./)
    assert.ok(message.text.includes("https://matchbase.example/matches/m-epl-liv-mci"))
    assert.equal([...(message.html ?? "").matchAll(/<a\b/g)].length, 1)
    assert.ok(!`${message.subject}${message.text}${message.html}`.includes("fan@example.com"))
    assert.doesNotMatch(message.html ?? "", /<img|<script|src=/i)
    assert.deepEqual(matchReminderEmail(base), matchReminderEmail(base), "deterministic")
  })

  it("phrases every offset", () => {
    assert.deepEqual((["at_start", "5m", "15m", "30m", "1h", "1d"] as const).map(reminderPhrase), ["is starting now", "starts in 5 minutes", "starts in 15 minutes", "starts in 30 minutes", "starts in 1 hour", "starts in 1 day"])
  })

  it("escapes and cleans provider names, and drops unsafe or missing links", () => {
    const message = matchReminderEmail({ ...base, matchTitle: `<script>x</script>\nBcc: evil vs "B"`, matchUrl: "javascript:alert(1)" })
    assert.ok(!message.subject.includes("\n"))
    assert.ok((message.html ?? "").includes("&lt;script&gt;x&lt;/script&gt; Bcc: evil vs &quot;B&quot;"))
    assert.doesNotMatch(message.html ?? "", /<a\b/)
    assert.equal(invalidMessageReason(message), null)
    for (const url of ["http://matchbase.example/matches/x", "https://matchbase.example/matches/x?y=1", "https://u:p@matchbase.example/matches/x", "https://matchbase.example/other/x", null]) assert.equal(safeMatchUrl(url), null, String(url))
    assert.equal(safeMatchUrl("http://localhost:3000/matches/m-1"), "http://localhost:3000/matches/m-1")
  })
})

describe("Watchlist reminder card state", () => {
  it("keeps opt-out available whenever a user is opted in, and never offers opt-in without delivery", () => {
    const cases: [boolean, boolean, boolean, string][] = [
      // available, confirmed, enabled → state
      [false, true, true, "on-not-delivering"],
      [false, false, true, "on-not-delivering"],
      [true, false, true, "on-not-delivering"],
      [false, true, false, "off-unavailable"],
      [false, false, false, "off-unavailable"],
      [true, false, false, "unconfirmed"],
      [true, true, false, "off"],
      [true, true, true, "on"],
    ]
    for (const [available, confirmed, enabled, expected] of cases) {
      assert.equal(reminderSettingsState({ available, confirmed, enabled }), expected, JSON.stringify({ available, confirmed, enabled }))
    }
  })
})
