import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { participantsFromSides, validateParticipants } from "../../lib/data/match-participants"
import { matches, players, teams } from "../../lib/data/mock"

const teamMatch = participantsFromSides({ A: [{ teamId: "lakers" }], B: [{ teamId: "celtics" }] })
const singles = participantsFromSides({ A: [{ playerId: "alcaraz" }], B: [{ playerId: "sinner" }] })
const doubles = participantsFromSides({ A: [{ playerId: "hsieh" }, { playerId: "ostapenko" }], B: [{ playerId: "siniakova" }, { playerId: "townsend" }] })

function expectError(input: unknown, fragment: string) {
  const result = validateParticipants(input)
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, new RegExp(fragment))
}

describe("validateParticipants", () => {
  it("accepts one team per side", () => {
    const result = validateParticipants(teamMatch)
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.participants.map((p) => `${p.side}${p.order}:${p.teamId}`), ["A1:lakers", "B1:celtics"])
  })

  it("accepts singles and doubles player sides", () => {
    assert.equal(validateParticipants(singles).ok, true)
    const result = validateParticipants(doubles)
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.participants.map((p) => `${p.side}${p.order}`), ["A1", "A2", "B1", "B2"])
  })

  it("orders the result by side then position regardless of input order", () => {
    const result = validateParticipants([...doubles].reverse())
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.participants.map((p) => p.playerId), ["hsieh", "ostapenko", "siniakova", "townsend"])
  })

  it("requires a participant on both sides", () => {
    expectError([], "both sides")
    expectError([{ side: "A", order: 1, teamId: "lakers" }], "Side B has no participant")
  })

  it("requires exactly one of team or player", () => {
    expectError([{ side: "A", order: 1 }, { side: "B", order: 1, teamId: "celtics" }], "exactly one team or one player")
    expectError([{ side: "A", order: 1, teamId: "lakers", playerId: "lebron" }, { side: "B", order: 1, teamId: "celtics" }], "exactly one team or one player")
  })

  it("rejects the same team or player on both sides, or twice on one side", () => {
    expectError(participantsFromSides({ A: [{ teamId: "lakers" }], B: [{ teamId: "lakers" }] }), "cannot appear twice")
    expectError(participantsFromSides({ A: [{ playerId: "hsieh" }, { playerId: "hsieh" }], B: [{ playerId: "sinner" }] }), "cannot appear twice")
  })

  it("rejects duplicate positions and non-positive positions", () => {
    expectError([{ side: "A", order: 1, teamId: "lakers" }, { side: "A", order: 1, teamId: "warriors" }, { side: "B", order: 1, teamId: "celtics" }], "two participants at position 1")
    expectError([{ side: "A", order: 0, teamId: "lakers" }, { side: "B", order: 1, teamId: "celtics" }], "whole numbers from 1")
    expectError([{ side: "A", order: 1.5, teamId: "lakers" }, { side: "B", order: 1, teamId: "celtics" }], "whole numbers from 1")
  })

  it("rejects mixed team-and-player sides and two teams on one side", () => {
    expectError([{ side: "A", order: 1, teamId: "lakers" }, { side: "A", order: 2, playerId: "lebron" }, { side: "B", order: 1, teamId: "celtics" }], "mixes a team with players")
    expectError([{ side: "A", order: 1, teamId: "lakers" }, { side: "A", order: 2, teamId: "warriors" }, { side: "B", order: 1, teamId: "celtics" }], "only one team")
  })

  it("rejects sides other than A and B and malformed input", () => {
    expectError([{ side: "home", order: 1, teamId: "lakers" }], "side A or side B")
    expectError("nope", "both sides")
    expectError([null], "Invalid participant")
  })
})

describe("mock dataset", () => {
  it("every mock match has a valid participant set", () => {
    for (const match of matches) {
      const result = validateParticipants(match.participants)
      assert.equal(result.ok, true, `${match.id}: ${result.ok ? "" : result.error}`)
    }
  })

  it("team-sport matches keep exactly one team per side and tennis matches use only players", () => {
    const tennis = matches.filter((m) => m.leagueId === "wimbledon")
    assert.equal(tennis.length, 3)
    for (const match of tennis) assert.ok(match.participants.every((p) => p.playerId !== undefined && p.teamId === undefined), match.id)
    const doublesFinal = matches.find((m) => m.id === "m-wim-doubles-final")
    assert.deepEqual(doublesFinal?.participants.map((p) => `${p.side}${p.order}`), ["A1", "A2", "B1", "B2"])
    for (const match of matches.filter((m) => m.leagueId !== "wimbledon")) {
      assert.deepEqual(match.participants.map((p) => `${p.side}${p.order}`), ["A1", "B1"], match.id)
      assert.ok(match.participants.every((p) => p.teamId !== undefined), match.id)
    }
  })

  it("tennis players have no team and no fake team exists for them", () => {
    const tennisPlayers = players.filter((p) => ["alcaraz", "sinner", "hsieh", "ostapenko", "siniakova", "townsend"].includes(p.id))
    assert.equal(tennisPlayers.length, 6)
    for (const player of tennisPlayers) assert.equal(player.teamId, undefined, player.id)
    assert.equal(teams.some((t) => t.leagueId === "wimbledon"), false)
  })

  it("participant ids are unique across the dataset", () => {
    const ids = matches.flatMap((m) => m.participants.map((p) => p.id))
    assert.equal(new Set(ids).size, ids.length)
  })
})
