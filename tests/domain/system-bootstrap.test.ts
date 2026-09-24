import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { systemDataSources, systemSports, validateSystemBootstrap } from "../../lib/data/system-bootstrap"
import { dataSourceProviders } from "../../lib/data/sync/providers/registry"
import { sports } from "../../lib/sports"

/** The non-demo bootstrap set is derived from the code registries and covers every provider binding. */

describe("system bootstrap data", () => {
  it("includes every sport in registry order with its metadata", () => {
    const rows = systemSports()
    assert.deepEqual(rows.map((r) => r.id), sports)
    assert.deepEqual(rows.map((r) => r.sortOrder), sports.map((_, i) => i))
    assert.equal(rows.find((r) => r.id === "football")?.homeAway, true)
    assert.equal(rows.find((r) => r.id === "lol")?.category, "esports")
  })
  it("includes one ACTIVE-to-be data source per live provider binding and no mock by default", () => {
    const live = systemDataSources()
    assert.deepEqual(live.map((r) => r.id).sort(), ["ds-tennis-sportradar", "ds-thesportsdb-epl"])
    assert.ok(live.every((r) => r.kind === "live"))
    assert.equal(live.find((r) => r.id === "ds-thesportsdb-epl")?.sportId, "football")
    assert.equal(live.find((r) => r.id === "ds-thesportsdb-epl")?.name, "TheSportsDB · Premier League")
    const all = systemDataSources({ includeMock: true })
    assert.deepEqual(all.map((r) => r.id).sort(), Object.keys(dataSourceProviders).sort())
  })
  it("never includes demo-only placeholder sources", () => {
    for (const id of ["ds-nba", "ds-lck", "ds-epl", "ds-manual"]) assert.equal(systemDataSources({ includeMock: true }).some((r) => r.id === id), false, id)
  })
  it("is internally consistent (every source's sport is a bootstrap sport)", () => {
    assert.deepEqual(validateSystemBootstrap(), [])
  })
})
