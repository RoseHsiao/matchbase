import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { League, MatchView, Player, Team } from "../../lib/data/types"
import {
  matchInvolvesPlayer,
  matchInvolvesTeam,
  matchTitle,
  otherSide,
  participantName,
  participantSearchTerms,
  sideName,
  sideOf,
  sideParticipants,
  sideRole,
  sideScore,
  winnerSide,
} from "../../lib/matches"

const nba: League = { id: "nba", name: "NBA", shortName: "NBA", sport: "basketball", region: "North America", season: "2026-27" }
const lck: League = { id: "lck", name: "LCK", shortName: "LCK", sport: "lol", region: "South Korea", season: "2026 Season" }
const wimbledon: League = { id: "wimbledon", name: "Wimbledon", shortName: "Wimbledon", sport: "tennis", region: "United Kingdom", season: "2026" }

const team = (id: string, name: string, code: string, leagueId: string): Team => ({ id, name, shortName: name, code, leagueId, color: "#000" })
const player = (id: string, name: string, handle?: string): Player => ({ id, name, handle, role: "" })

const lakers = team("lakers", "Los Angeles Lakers", "LAL", "nba")
const celtics = team("celtics", "Boston Celtics", "BOS", "nba")

function teamMatch(id: string, league: League, a: Team, b: Team, extra: Partial<MatchView> = {}): MatchView {
  return {
    id,
    leagueId: league.id,
    league,
    startsAt: "2026-09-14T04:00:00.000Z",
    status: "upcoming",
    participants: [
      { id: `${id}-A1`, side: "A", order: 1, teamId: a.id, team: a },
      { id: `${id}-B1`, side: "B", order: 1, teamId: b.id, team: b },
    ],
    ...extra,
  }
}

const alcaraz = player("alcaraz", "Carlos Alcaraz")
const sinner = player("sinner", "Jannik Sinner")
const hsieh = player("hsieh", "Hsieh Su-wei")
const ostapenko = player("ostapenko", "Jeļena Ostapenko")
const siniakova = player("siniakova", "Kateřina Siniaková")
const townsend = player("townsend", "Taylor Townsend")

const singles: MatchView = {
  id: "singles",
  leagueId: "wimbledon",
  league: wimbledon,
  startsAt: "2026-09-13T06:00:00.000Z",
  status: "finished",
  score: { a: 3, b: 1 },
  participants: [
    { id: "s-A1", side: "A", order: 1, playerId: "alcaraz", player: alcaraz },
    { id: "s-B1", side: "B", order: 1, playerId: "sinner", player: sinner },
  ],
}

const doubles: MatchView = {
  id: "doubles",
  leagueId: "wimbledon",
  league: wimbledon,
  startsAt: "2026-09-16T05:00:00.000Z",
  status: "upcoming",
  // Deliberately out of order to prove ordering comes from `order`, not array position.
  participants: [
    { id: "d-B2", side: "B", order: 2, playerId: "townsend", player: townsend },
    { id: "d-A2", side: "A", order: 2, playerId: "ostapenko", player: ostapenko },
    { id: "d-B1", side: "B", order: 1, playerId: "siniakova", player: siniakova },
    { id: "d-A1", side: "A", order: 1, playerId: "hsieh", player: hsieh },
  ],
}

describe("Home/Away as a presentation concept", () => {
  it("labels side A Home and side B Away only for sports with home advantage", () => {
    assert.equal(sideRole("basketball", "A"), "Home")
    assert.equal(sideRole("basketball", "B"), "Away")
    assert.equal(sideRole("football", "A"), "Home")
    assert.equal(sideRole("lol", "A"), undefined)
    assert.equal(sideRole("lol", "B"), undefined)
    assert.equal(sideRole("tennis", "A"), undefined)
    assert.equal(sideRole("tennis", "B"), undefined)
  })

  it("keeps team match behaviour: side names, title, and scores", () => {
    const match = teamMatch("m", nba, lakers, celtics, { status: "finished", score: { a: 112, b: 104 } })
    assert.equal(sideName(match, "A"), "Los Angeles Lakers")
    assert.equal(sideName(match, "B", "code"), "BOS")
    assert.equal(matchTitle(match), "Los Angeles Lakers vs Boston Celtics")
    assert.equal(sideScore(match, "A"), 112)
    assert.equal(sideScore(match, "B"), 104)
    assert.equal(winnerSide(match), "A")
    assert.equal(sideOf(match, { teamId: "celtics" }), "B")
    assert.equal(otherSide("B"), "A")
    assert.ok(matchInvolvesTeam(match, "lakers"))
    assert.equal(matchInvolvesTeam(match, "warriors"), false)
  })

  it("has no winner for draws, unfinished matches, or missing scores", () => {
    assert.equal(winnerSide(teamMatch("m", lck, lakers, celtics, { status: "finished", score: { a: 1, b: 1 } })), undefined)
    assert.equal(winnerSide(teamMatch("m", lck, lakers, celtics, { status: "live", score: { a: 2, b: 0 } })), undefined)
    assert.equal(winnerSide(teamMatch("m", lck, lakers, celtics)), undefined)
  })
})

describe("player participants", () => {
  it("renders singles by player name and finds the winner", () => {
    assert.equal(matchTitle(singles), "Carlos Alcaraz vs Jannik Sinner")
    assert.equal(winnerSide(singles), "A")
    assert.ok(matchInvolvesPlayer(singles, "sinner"))
    assert.equal(matchInvolvesTeam(singles, "sinner"), false)
    assert.equal(sideOf(singles, { playerId: "sinner" }), "B")
  })

  it("renders doubles as 'Player A / Player B' ordered by position", () => {
    assert.deepEqual(sideParticipants(doubles, "A").map((p) => p.playerId), ["hsieh", "ostapenko"])
    assert.equal(sideName(doubles, "A"), "Hsieh Su-wei / Jeļena Ostapenko")
    assert.equal(sideName(doubles, "B"), "Kateřina Siniaková / Taylor Townsend")
    assert.equal(matchTitle(doubles), "Hsieh Su-wei / Jeļena Ostapenko vs Kateřina Siniaková / Taylor Townsend")
  })

  it("uses the handle for esports players and initials as a code fallback", () => {
    const faker = player("faker", "Lee Sang-hyeok", "Faker")
    assert.equal(participantName({ id: "x", side: "A", order: 1, playerId: "faker", player: faker }), "Faker")
    assert.equal(participantName({ id: "x", side: "A", order: 1, playerId: "faker", player: faker }, "code"), "Faker")
    assert.equal(participantName({ id: "x", side: "A", order: 1, playerId: "alcaraz", player: alcaraz }, "code"), "CA")
  })

  it("exposes player names to search alongside team names", () => {
    assert.deepEqual(participantSearchTerms(singles), ["Carlos Alcaraz", "Jannik Sinner"])
    assert.deepEqual(participantSearchTerms(teamMatch("m", nba, lakers, celtics)), ["Los Angeles Lakers", "Los Angeles Lakers", "LAL", "Boston Celtics", "Boston Celtics", "BOS"])
  })
})
