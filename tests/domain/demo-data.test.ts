import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { checkDemoConsistency, LIVE_WINDOW_MS } from "../../lib/data/demo-consistency"
import { buildDemoData, currentUserFollows, leagues, players, teams } from "../../lib/data/mock"
import { createDemoClock } from "../../lib/demo-clock"
import { getReminderAt } from "../../lib/reminders"

const anchorA = new Date("2026-09-14T04:00:00.000Z")
const anchorB = new Date("2027-03-01T15:30:00.000Z")

function data(anchor: Date) {
  const clock = createDemoClock({ anchor })
  return { clock, ...buildDemoData(clock) }
}

describe("demo timeline", () => {
  test("the timeline is coherent for a fixed anchor", () => {
    const { clock, matches } = data(anchorA)
    assert.deepEqual(checkDemoConsistency({ matches, follows: currentUserFollows }, clock), [])
  })

  test("it stays coherent for arbitrary anchors, including odd times of day and other years", () => {
    for (const iso of ["2026-09-14T04:00:00Z", "2026-12-31T23:45:00Z", "2027-02-28T00:10:00Z", "2030-06-15T15:30:00Z", "2028-02-29T09:00:00Z"]) {
      const { clock, matches } = data(new Date(iso))
      assert.deepEqual(checkDemoConsistency({ matches, follows: currentUserFollows }, clock), [], iso)
    }
  })

  test("upcoming matches are in the future, finished in the past, live within the live window", () => {
    const { clock, matches } = data(anchorA)
    const anchor = clock.anchor.getTime()
    for (const match of matches) {
      const start = Date.parse(match.startsAt)
      if (match.status === "upcoming") assert.ok(start > anchor, `${match.id} upcoming but not after the anchor`)
      if (match.status === "finished") assert.ok(start < anchor, `${match.id} finished but not before the anchor`)
      if (match.status === "live") assert.ok(start <= anchor && anchor - start <= LIVE_WINDOW_MS, `${match.id} live outside the window`)
    }
  })

  test("the journey is populated: today, tomorrow, later this week, history, and every domain", () => {
    const { clock, matches } = data(anchorA)
    const day = (match: { startsAt: string }) => Math.floor((Date.parse(match.startsAt) - clock.at(0, 0).getTime()) / 86_400_000)
    const todayUpcoming = matches.filter((m) => m.status === "upcoming" && day(m) === 0)
    const tomorrow = matches.filter((m) => m.status === "upcoming" && day(m) === 1)
    const laterThisWeek = matches.filter((m) => m.status === "upcoming" && day(m) >= 2 && day(m) <= 6)
    const live = matches.filter((m) => m.status === "live")
    const finished = matches.filter((m) => m.status === "finished")
    assert.ok(todayUpcoming.length >= 3, "today has upcoming matches")
    assert.ok(live.length >= 1, "today has a live match")
    assert.ok(tomorrow.length >= 3, "tomorrow has matches")
    assert.ok(laterThisWeek.length >= 3, "later this week has matches")
    assert.ok(finished.length >= 4, "history has finished matches")
    const sportOf = (m: { leagueId: string }) => leagues.find((l) => l.id === m.leagueId)?.sport
    const sportsCovered = new Set(matches.map(sportOf))
    for (const sport of ["football", "basketball", "tennis", "lol", "valorant", "cs2"]) assert.ok(sportsCovered.has(sport as never), sport)
    const singles = matches.filter((m) => m.participants.every((p) => p.playerId) && m.participants.length === 2)
    const doubles = matches.filter((m) => m.participants.every((p) => p.playerId) && m.participants.length === 4)
    assert.ok(singles.length >= 1 && doubles.length >= 1, "tennis singles and doubles exist")
  })

  test("every reminder fires after the anchor and before its match", () => {
    const { clock, matches } = data(anchorA)
    const byId = new Map(matches.map((m) => [m.id, m]))
    let checked = 0
    for (const [matchId, reminder] of Object.entries(currentUserFollows.watchlistReminders)) {
      if (reminder === "off") continue
      const match = byId.get(matchId)
      assert.ok(match && match.status === "upcoming", `${matchId} is an upcoming match`)
      const fires = getReminderAt(match.startsAt, reminder)
      assert.ok(fires, "reminder has an instant")
      assert.ok(fires.getTime() > clock.anchor.getTime(), `${matchId} reminder is in the future`)
      assert.ok(fires.getTime() <= Date.parse(match.startsAt), `${matchId} reminder is not after the match`)
      checked++
    }
    assert.ok(checked >= 3)
    const upcomingSaved = currentUserFollows.watchlistMatchIds.filter((id) => byId.get(id)?.status === "upcoming")
    assert.ok(upcomingSaved.some((id) => (currentUserFollows.watchlistReminders[id] ?? "off") === "off"), "an upcoming saved match without a reminder exists")
  })

  test("the same anchor produces identical output", () => {
    const first = buildDemoData(createDemoClock({ anchor: anchorA }))
    const second = buildDemoData(createDemoClock({ anchor: new Date(anchorA.getTime()) }))
    assert.deepEqual(second, first)
  })

  test("a different anchor changes every timestamp but no id, status, participant, or score", () => {
    const a = data(anchorA)
    const b = data(anchorB)
    assert.deepEqual(b.matches.map((m) => m.id), a.matches.map((m) => m.id))
    for (let i = 0; i < a.matches.length; i++) {
      const { startsAt: sa, ...restA } = a.matches[i]
      const { startsAt: sb, ...restB } = b.matches[i]
      assert.notEqual(sa, sb, `${restA.id} moved`)
      assert.deepEqual(restB, restA)
    }
    assert.deepEqual(b.dataSources.map((d) => d.id), a.dataSources.map((d) => d.id))
    assert.deepEqual(b.syncLogs.map((l) => l.id), a.syncLogs.map((l) => l.id))
    assert.deepEqual(checkDemoConsistency({ matches: b.matches, follows: currentUserFollows }, b.clock), [])
  })

  test("anchor-relative offsets are exact; day-relative times keep their Taipei wall-clock", () => {
    const { clock, matches } = data(anchorB)
    const byId = new Map(matches.map((m) => [m.id, m]))
    assert.equal(Date.parse(byId.get("m-epl-liv-mci")!.startsAt), clock.fromAnchor(150).getTime())
    assert.equal(Date.parse(byId.get("m-epl-ars-che")!.startsAt), clock.fromAnchor(-67).getTime())
    // Tomorrow 21:00 in Taipei is 13:00 UTC, whatever the anchor's time of day.
    assert.equal(byId.get("m-ucl-rma-fcb")!.startsAt.slice(11), "13:00:00.000Z")
  })

  test("participants reference existing teams and players and never a fake tennis team", () => {
    const { matches } = data(anchorA)
    const teamIds = new Set(teams.map((t) => t.id))
    const playerIds = new Set(players.map((p) => p.id))
    const tennisLeagueIds = new Set(leagues.filter((l) => l.sport === "tennis").map((l) => l.id))
    assert.equal(teams.filter((t) => tennisLeagueIds.has(t.leagueId)).length, 0)
    for (const match of matches) {
      for (const p of match.participants) {
        if (p.teamId) assert.ok(teamIds.has(p.teamId), `${match.id} team ${p.teamId}`)
        if (p.playerId) assert.ok(playerIds.has(p.playerId), `${match.id} player ${p.playerId}`)
      }
      if (tennisLeagueIds.has(match.leagueId)) assert.ok(match.participants.every((p) => p.playerId && !p.teamId), `${match.id} tennis sides are players`)
    }
  })

  test("consistency checker catches contradictions", () => {
    const { clock, matches } = data(anchorA)
    const broken = matches.map((m) => (m.id === "m-epl-liv-mci" ? { ...m, status: "finished" as const, score: { a: 1, b: 0 } } : m))
    const issues = checkDemoConsistency({ matches: broken, follows: currentUserFollows }, clock)
    assert.ok(issues.some((i) => /m-epl-liv-mci: finished but starts at or after/.test(i)))
    assert.ok(issues.some((i) => /m-epl-liv-mci: reminder "15m" on a finished match/.test(i)))
    const stale = checkDemoConsistency({ matches, follows: { watchlistMatchIds: ["m-lck-t1-hle"], watchlistReminders: { "m-lck-t1-hle": "1h" } } }, clock)
    assert.ok(stale.some((i) => /reminder "1h" on a finished match/.test(i)))
  })
})
