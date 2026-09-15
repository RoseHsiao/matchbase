import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { resolveSides, sidesOfTeamMatch, toPersistable } from "../../lib/data/sync/participants"
import type { NormalizedIndividualMatch, NormalizedMatch } from "../../lib/data/sync/types"

const resolvers = {
  teamIds: new Map([["ext-lal", "lakers"], ["ext-bos", "celtics"]]),
  playerIds: new Map([["p-alc", "alcaraz"], ["p-sin", "sinner"], ["p-hsi", "hsieh"], ["p-ost", "ostapenko"], ["p-sia", "siniakova"], ["p-tow", "townsend"]]),
}

const teamMatch: NormalizedMatch = {
  externalId: "g1",
  leagueExternalId: "nba",
  seasonExternalId: "2026",
  homeTeamExternalId: "ext-lal",
  awayTeamExternalId: "ext-bos",
  startsAt: "2026-09-14T02:00:00Z",
  status: "finished",
  homeScore: 112,
  awayScore: 104,
}

const doubles: NormalizedIndividualMatch = {
  externalId: "t1",
  leagueExternalId: "wim",
  seasonExternalId: "2026",
  startsAt: "2026-09-16T13:00:00Z",
  status: "upcoming",
  sides: [
    { participants: [{ kind: "player", externalId: "p-hsi" }, { kind: "player", externalId: "p-ost" }] },
    { participants: [{ kind: "player", externalId: "p-sia" }, { kind: "player", externalId: "p-tow" }] },
  ],
}

describe("sync participant conversion", () => {
  it("maps a team match: provider home becomes side A, away becomes side B", () => {
    const sides = sidesOfTeamMatch(teamMatch)
    const resolved = resolveSides(sides, resolvers)
    assert.deepEqual(resolved.participants, [
      { side: "A", order: 1, teamId: "lakers", playerId: undefined },
      { side: "B", order: 1, teamId: "celtics", playerId: undefined },
    ])
    assert.equal(resolved.sideAScore, 112)
    assert.equal(resolved.sideBScore, 104)
  })

  it("maps singles and doubles player sides in provider order", () => {
    const singles: NormalizedIndividualMatch = { ...doubles, externalId: "t0", status: "finished", sides: [{ participants: [{ kind: "player", externalId: "p-alc" }], score: 3 }, { participants: [{ kind: "player", externalId: "p-sin" }], score: 1 }] }
    const s = resolveSides(singles.sides, resolvers)
    assert.deepEqual(s.participants.map((p) => `${p.side}${p.order}:${p.playerId}`), ["A1:alcaraz", "B1:sinner"])
    assert.equal(s.sideAScore, 3)
    assert.equal(s.sideBScore, 1)
    const d = resolveSides(doubles.sides, resolvers)
    assert.deepEqual(d.participants.map((p) => `${p.side}${p.order}:${p.playerId}`), ["A1:hsieh", "A2:ostapenko", "B1:siniakova", "B2:townsend"])
    assert.equal(d.sideAScore, undefined)
  })

  it("drops a lone score and flags it", () => {
    const persistable = toPersistable({ ...teamMatch, awayScore: undefined })
    assert.equal(persistable.loneScore, true)
    const resolved = resolveSides(persistable.sides, resolvers)
    assert.equal(resolved.sideAScore, undefined)
    assert.equal(resolved.sideBScore, undefined)
  })

  it("fails the record when a side references an unsynced team or player", () => {
    assert.throws(() => resolveSides(sidesOfTeamMatch({ ...teamMatch, awayTeamExternalId: "ext-unknown" }), resolvers), /Team ext-unknown was not synced/)
    assert.throws(() => resolveSides([{ participants: [{ kind: "player", externalId: "p-alc" }] }, { participants: [{ kind: "player", externalId: "p-nobody" }] }], resolvers), /Player p-nobody was not synced/)
  })

  it("applies the shared participant rules (same team on both sides)", () => {
    assert.throws(() => resolveSides(sidesOfTeamMatch({ ...teamMatch, awayTeamExternalId: "ext-lal" }), resolvers), /cannot appear twice/)
  })

  it("reduces both normalized shapes to one persistable form", () => {
    const a = toPersistable(teamMatch)
    const b = toPersistable(doubles)
    assert.equal(a.sides[0].participants[0].kind, "team")
    assert.equal(b.sides[0].participants.length, 2)
    assert.equal(a.externalId, "g1")
    assert.equal(b.status, "upcoming")
  })
})
