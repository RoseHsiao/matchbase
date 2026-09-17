import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { establishedLevels, groupByHierarchy, type HierarchyRef } from "../../lib/hierarchy"
import { ALL } from "../../lib/schedule"

type Item = { id: string; ref?: HierarchyRef }

const nba = { id: "nba", name: "NBA" }
const epl = { id: "epl", name: "Premier League" }
const lck = { id: "lck", name: "LCK" }
const lec = { id: "lec", name: "LoL EMEA Championship" }
const wimbledon = { id: "wimbledon", name: "The Championships, Wimbledon" }

const items: Item[] = [
  { id: "t1", ref: { sport: "lol", league: lck } },
  { id: "arsenal", ref: { sport: "football", league: epl } },
  { id: "alcaraz", ref: { sport: "tennis", league: wimbledon } },
  { id: "lakers", ref: { sport: "basketball", league: nba } },
  { id: "g2", ref: { sport: "lol", league: lec } },
  { id: "celtics", ref: { sport: "basketball", league: nba } },
]

const none = { query: "", category: ALL, sport: ALL, leagueId: ALL, teamId: ALL } as const
const refOf = (item: Item) => item.ref

describe("establishedLevels", () => {
  test("nothing selected establishes nothing", () => {
    assert.deepEqual(establishedLevels(none), { category: false, sport: false, league: false })
  })
  test("a category establishes only the category", () => {
    assert.deepEqual(establishedLevels({ ...none, category: "esports" }), { category: true, sport: false, league: false })
  })
  test("a sport implies its category", () => {
    assert.deepEqual(establishedLevels({ ...none, sport: "lol" }), { category: true, sport: true, league: false })
  })
  test("a league implies its sport and category", () => {
    assert.deepEqual(establishedLevels({ ...none, leagueId: "lck" }), { category: true, sport: true, league: true })
  })
  test("a team implies its league, sport and category", () => {
    assert.deepEqual(establishedLevels({ ...none, teamId: "t1" }), { category: true, sport: true, league: true })
  })
})

describe("groupByHierarchy", () => {
  test("unfiltered: category tiers in registry order, sections by sport order then league name, items in input order", () => {
    const grouped = groupByHierarchy(items, refOf, none)
    assert.equal(grouped.layout, "tiers")
    assert.equal(grouped.total, 6)
    assert.deepEqual(
      grouped.tiers.map((tier) => tier.category),
      ["sports", "esports"]
    )
    assert.deepEqual(
      grouped.tiers[0].sections.map((s) => `${s.sport}/${s.league?.id}`),
      ["football/epl", "basketball/nba", "tennis/wimbledon"]
    )
    assert.deepEqual(
      grouped.tiers[1].sections.map((s) => `${s.sport}/${s.league?.id}`),
      ["lol/lck", "lol/lec"]
    )
    assert.deepEqual(
      grouped.tiers[0].sections[1].items.map((i) => i.id),
      ["lakers", "celtics"]
    )
    assert.deepEqual(grouped.tiers.map((t) => t.count), [4, 2])
  })

  test("category selected: no tier heading, sections keep sport and league", () => {
    const grouped = groupByHierarchy(
      items.filter((i) => i.ref?.sport === "lol"),
      refOf,
      { ...none, category: "esports" }
    )
    assert.equal(grouped.layout, "sections")
    assert.deepEqual(grouped.established, { category: true, sport: false, league: false })
    assert.equal(grouped.tiers.length, 1)
    assert.equal(grouped.tiers[0].sections.length, 2)
  })

  test("sport selected: sections remain so leagues stay distinguishable, with the sport established", () => {
    const grouped = groupByHierarchy(
      items.filter((i) => i.ref?.sport === "lol"),
      refOf,
      { ...none, sport: "lol" }
    )
    assert.equal(grouped.layout, "sections")
    assert.equal(grouped.established.sport, true)
    assert.equal(grouped.established.league, false)
  })

  test("league selected: flat, the filters already name the whole context", () => {
    const grouped = groupByHierarchy(
      items.filter((i) => i.ref?.league?.id === "nba"),
      refOf,
      { ...none, leagueId: "nba" }
    )
    assert.equal(grouped.layout, "flat")
  })

  test("team selected: flat", () => {
    assert.equal(groupByHierarchy(items.slice(0, 1), refOf, { ...none, teamId: "t1" }).layout, "flat")
  })

  test("search across everything: sections with context instead of category tiers", () => {
    const grouped = groupByHierarchy(items, refOf, { ...none, query: "a" })
    assert.equal(grouped.layout, "sections")
    assert.equal(grouped.established.category, false)
    assert.equal(grouped.tiers.length, 2)
  })

  test("a single category present: no lone tier heading", () => {
    const grouped = groupByHierarchy(items.filter((i) => i.ref?.sport === "tennis"), refOf, none)
    assert.equal(grouped.layout, "sections")
  })

  test("items without a hierarchy position are kept, last", () => {
    const grouped = groupByHierarchy([{ id: "rookie" }, ...items], refOf, none)
    assert.deepEqual(grouped.unassigned.map((i) => i.id), ["rookie"])
    assert.equal(grouped.total, 7)
    assert.equal(grouped.tiers.reduce((n, t) => n + t.count, 0), 6)
  })

  test("empty input", () => {
    const grouped = groupByHierarchy([], refOf, none)
    assert.equal(grouped.total, 0)
    assert.deepEqual(grouped.tiers, [])
    assert.equal(grouped.layout, "sections")
  })
})
