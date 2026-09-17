import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { mockBasketballProvider } from "../../lib/data/sync/providers/mock-basketball"
import { dataSourceProviders, describeDataSourceProvider, providers, resolveProvider } from "../../lib/data/sync/providers/registry"
import {
  createTheSportsDbProvider,
  dayWindow,
  DEFAULT_BASE_URL,
  endpoint,
  leagueNameParameter,
  PUBLIC_FREE_API_KEY,
  readTheSportsDbConfig,
  seasonWindow,
  SPORT_MAP,
  STATUS_MAP,
  theSportsDbPremierLeagueProvider,
  toInstant,
  validateTheSportsDbConfig,
  type RawEvent,
} from "../../lib/data/sync/providers/thesportsdb"
import { ProviderConfigurationError } from "../../lib/data/sync/types"
import { HttpError, MalformedResponseError } from "../../lib/data/sync/utils/http"

import { broken, configured, context, dayEvents, fakeApi, league, nextEvent, pastEvent, seasonEvents, source, SOURCE_ID, teamList } from "./fixtures/thesportsdb"

function provider(options: Parameters<typeof fakeApi>[0] = {}, config = configured()) {
  const api = fakeApi(options)
  return { api, provider: createTheSportsDbProvider(source, { config, request: api.request }) }
}

async function snapshot(options: Parameters<typeof fakeApi>[0] = {}, config = configured()) {
  const { api, provider: p } = provider(options, config)
  const raw = await p.fetch(context)
  return { api, raw, snapshot: p.normalize(raw, context) }
}

describe("registry", () => {
  it("registers the TheSportsDB Premier League provider next to the others", () => {
    assert.ok(providers["thesportsdb-epl"])
    assert.ok(providers["sportradar-tennis"])
    assert.ok(providers[mockBasketballProvider.key])
    assert.equal(dataSourceProviders[SOURCE_ID], "thesportsdb-epl")
    assert.equal(resolveProvider(SOURCE_ID)?.key, "thesportsdb-epl")
    assert.equal(theSportsDbPremierLeagueProvider.sport, "football")
    assert.equal(theSportsDbPremierLeagueProvider.kind, "live")
  })

  it("describes itself to Admin as configured with the public key and its limits, without leaking anything", () => {
    const info = describeDataSourceProvider(SOURCE_ID)
    assert.ok(info && info.configuration.configured)
    assert.match(info.configuration.configured ? (info.configuration.detail ?? "") : "", /public free V1 key .* league 4328 .* requests per run/)
  })
})

describe("configuration", () => {
  it("defaults to the documented public key and base URL with gentle throttling", () => {
    const config = readTheSportsDbConfig({})
    assert.equal(config.apiKey, PUBLIC_FREE_API_KEY)
    assert.equal(config.baseUrl, DEFAULT_BASE_URL)
    assert.equal(config.requestIntervalMs, 2500)
    assert.ok(Math.floor(60_000 / config.requestIntervalMs) < 30, "stays below the free tier's 30 requests per minute")
    assert.equal(config.pastDays, 2)
    assert.equal(config.futureDays, 7)
    assert.equal(config.maxRequestsPerRun, 28)
    assert.equal(config.season, undefined)
  })

  it("reads overrides from the environment", () => {
    const config = readTheSportsDbConfig({ THESPORTSDB_API_KEY: " abc ", THESPORTSDB_BASE_URL: "https://proxy.test/v1/json/", THESPORTSDB_REQUEST_INTERVAL_MS: "4000", THESPORTSDB_PAST_DAYS: "1", THESPORTSDB_FUTURE_DAYS: "3", THESPORTSDB_MAX_REQUESTS: "12", THESPORTSDB_SEASON: "2025-2026" })
    assert.deepEqual(config, { apiKey: "abc", baseUrl: "https://proxy.test/v1/json", requestIntervalMs: 4000, pastDays: 1, futureDays: 3, maxRequestsPerRun: 12, season: "2025-2026" })
  })

  it("reports every problem in one message", () => {
    const bad = validateTheSportsDbConfig({ apiKey: "", baseUrl: "ftp://x", requestIntervalMs: -1, pastDays: -1, futureDays: 0, maxRequestsPerRun: 2 }, { ...source, leagueId: "epl" })
    assert.equal(bad.configured, false)
    if (!bad.configured) {
      for (const fragment of ["THESPORTSDB_API_KEY is empty", "THESPORTSDB_BASE_URL", "THESPORTSDB_REQUEST_INTERVAL_MS", "PAST_DAYS", "THESPORTSDB_MAX_REQUESTS", 'league id "epl"']) assert.match(bad.error, new RegExp(fragment))
    }
  })

  it("a bad configuration fails the fetch as a configuration error without a request", async () => {
    const { api, provider: p } = provider({}, configured({ apiKey: "" }))
    await assert.rejects(p.fetch(context), (e: unknown) => e instanceof ProviderConfigurationError)
    assert.equal(api.calls.length, 0)
  })
})

describe("endpoints", () => {
  it("puts the key in the path and encodes parameters as the V1 documentation shows", () => {
    assert.equal(endpoint({ baseUrl: DEFAULT_BASE_URL, apiKey: "123" }, "lookupleague.php", { id: "4328" }), "https://www.thesportsdb.com/api/v1/json/123/lookupleague.php?id=4328")
    assert.equal(endpoint({ baseUrl: DEFAULT_BASE_URL, apiKey: "123" }, "eventsseason.php", { id: "4328", s: "2026-2027" }), "https://www.thesportsdb.com/api/v1/json/123/eventsseason.php?id=4328&s=2026-2027")
    assert.equal(leagueNameParameter("English Premier League"), "English_Premier_League")
  })

  it("makes the five documented base calls, one day call per window day, and one lookup per missing team, in that order", async () => {
    const { api, raw } = await snapshot()
    const paths = api.calls.map((u) => new URL(u).pathname.split("/").pop())
    assert.deepEqual(paths.slice(0, 5), ["lookupleague.php", "search_all_teams.php", "eventsseason.php", "eventsnextleague.php", "eventspastleague.php"])
    const days = api.calls.filter((u) => u.includes("eventsday.php")).map((u) => new URL(u).searchParams.get("d"))
    assert.deepEqual(days, ["2026-09-16", "2026-09-17", "2026-09-18"])
    const lookups = api.calls.filter((u) => u.includes("lookupteam.php")).map((u) => new URL(u).searchParams.get("id")).sort()
    assert.deepEqual(lookups, ["133612", "133613", "133635", "134777"])
    assert.equal(raw.requestCount, api.calls.length)
    assert.ok(api.calls.every((u) => u.startsWith("https://api.example.test/v1/json/123/")))
  })

  it("uses the league's current season unless a season is configured", async () => {
    const a = await snapshot()
    assert.equal(a.raw.season, "2026-2027")
    const b = await snapshot({}, configured({ season: "2025-2026" }))
    assert.ok(b.api.calls.some((u) => u.includes("eventsseason.php") && u.includes("s=2025-2026")))
  })

  it("the day window is inclusive and computed in UTC", () => {
    assert.deepEqual(dayWindow(new Date("2026-12-31T23:30:00Z"), 1, 1), ["2026-12-30", "2026-12-31", "2027-01-01"])
    assert.deepEqual(dayWindow(new Date("2026-09-17T12:00:00Z"), 0, 0), ["2026-09-17"])
  })

  it("never exceeds the request budget: day calls stop and missing teams fall back to event data with warnings", async () => {
    const { api, raw, snapshot: s } = await snapshot({}, configured({ maxRequestsPerRun: 7 }))
    assert.equal(api.calls.length, 7)
    assert.equal(raw.requestCount, 7)
    assert.ok(raw.issues.some((i) => /day schedule stopped/.test(i.message)))
    assert.ok(raw.issues.some((i) => i.entity === "team" && /budget/.test(i.message)))
    // Leeds and Newcastle come from the past event, so they still exist as teams with derived codes.
    const leeds = s.teams.find((t) => t.externalId === "133635")
    assert.ok(leeds)
    assert.equal(leeds.name, "Leeds United")
    assert.equal(leeds.code, "LEE")
    assert.ok(s.issues.some((i) => i.entity === "team" && i.externalId === "133635" && /derived code/.test(i.message)))
  })
})

describe("normalize: league and season", () => {
  it("maps the league with the configured sport, a distinct short name and its country", async () => {
    const { snapshot: s } = await snapshot()
    assert.deepEqual(s.leagues, [{ externalId: "4328", sport: "football", name: "English Premier League", shortName: "Premier League", region: "England" }])
  })

  it("honours a configured short name", async () => {
    const api = fakeApi()
    const p = createTheSportsDbProvider({ ...source, shortName: "EPL (TSDB)" }, { config: configured(), request: api.request })
    const s = p.normalize(await p.fetch(context), context)
    assert.equal(s.leagues[0].shortName, "EPL (TSDB)")
  })

  it("refuses a league whose sport does not match the source as a configuration error", async () => {
    const { provider: p } = provider({ league: { leagues: [{ ...league, strSport: "Basketball" }] } })
    const raw = await p.fetch(context)
    assert.throws(() => p.normalize(raw, context), (e: unknown) => e instanceof ProviderConfigurationError && /Basketball/.test(String(e)))
    assert.equal(SPORT_MAP.Soccer, "football")
  })

  it("names the season by the feed's season string with a derived window and current status", async () => {
    const { snapshot: s } = await snapshot()
    assert.deepEqual(s.seasons, [{ externalId: "2026-2027", leagueExternalId: "4328", name: "2026-2027", startsAt: "2026-07-01", endsAt: "2027-06-30", status: "current" }])
    assert.deepEqual(seasonWindow("2024"), { startsAt: "2024-01-01", endsAt: "2024-12-31" })
    assert.equal(seasonWindow("Summer"), undefined)
  })

  it("a past configured season is completed, not current", async () => {
    const { snapshot: s } = await snapshot({ season: { events: [] } }, configured({ season: "2024-2025" }))
    assert.equal(s.seasons[0].status, "completed")
  })

  it("fails the run when the feed has no league or no current season", async () => {
    await assert.rejects(provider({ league: { leagues: null } }).provider.fetch(context), /no league/)
    await assert.rejects(provider({ league: { leagues: [{ ...league, strCurrentSeason: null }] } }).provider.fetch(context), /no current season/)
  })
})

describe("normalize: teams", () => {
  it("maps listed teams with provider ids, short codes, badge URLs and colours; empty colour becomes undefined", async () => {
    const { snapshot: s } = await snapshot()
    const arsenal = s.teams.find((t) => t.externalId === "133604")
    assert.deepEqual(arsenal, { externalId: "133604", leagueExternalId: "4328", name: "Arsenal", shortName: "Arsenal", code: "ARS", color: "#EF0107", logoUrl: "https://r2.thesportsdb.com/images/media/team/badge/arsenal.png" })
    const brentford = s.teams.find((t) => t.externalId === "134355")
    assert.equal(brentford?.color, undefined)
  })

  it("adds teams found by lookup and keeps codes unique within the league", async () => {
    const { snapshot: s } = await snapshot()
    assert.deepEqual(s.teams.map((t) => t.code).sort(), ["ARS", "BRE", "CHE", "LEE", "MCI", "MUN", "NEW"])
    assert.equal(new Set(s.teams.map((t) => t.code)).size, s.teams.length)
  })

  it("derives distinct codes when two unlisted clubs share initials", async () => {
    const { snapshot: s } = await snapshot({ lookups: {} }, configured({ maxRequestsPerRun: 100 }))
    const codes = s.teams.filter((t) => /^Manchester/.test(t.name)).map((t) => t.code)
    assert.equal(codes.length, 2)
    assert.equal(new Set(codes).size, 2)
    assert.ok(codes.every((c) => /^MAN/.test(c)))
  })

  it("a team without a name is a record-level error, and its events fail on their own", async () => {
    const { snapshot: s } = await snapshot({ teams: { teams: [{ ...teamList[0], strTeam: null }, teamList[1], teamList[2]] }, lookups: {}, days: {}, past: { events: [] } })
    assert.ok(s.issues.some((i) => i.level === "error" && i.entity === "team" && i.externalId === "133604"))
    // Arsenal is also named on the season events, so the event data rescues it there with a warning.
    assert.ok(s.teams.some((t) => t.externalId === "133604" && t.name === "Arsenal"))
    assert.ok(s.issues.some((i) => i.level === "warning" && i.externalId === "133604" && /derived code/.test(i.message)))
  })

  it("syncs no players in this phase", async () => {
    const { snapshot: s } = await snapshot()
    assert.deepEqual(s.players, [])
  })
})

describe("normalize: events", () => {
  it("deduplicates events by idEvent across season, next, previous and day calls, freshest copy last", async () => {
    const { snapshot: s } = await snapshot()
    const ids = s.matches.map((m) => m.externalId)
    assert.equal(new Set(ids).size, ids.length)
    assert.deepEqual(ids, ["2494001", "2494002", "2494036", "2494030", "2494049", "2494050", "2494047"])
  })

  it("maps a finished event with the home team as side A, the away team as side B, and both scores", async () => {
    const { snapshot: s } = await snapshot()
    const m = s.matches.find((x) => x.externalId === "2494036")
    assert.deepEqual(m, { externalId: "2494036", leagueExternalId: "4328", seasonExternalId: "2026-2027", homeTeamExternalId: "133635", awayTeamExternalId: "134777", venueExternalId: "15534", startsAt: "2026-09-14T19:00:00.000Z", status: "finished", rawStatus: "FT", stage: "Matchweek 4", homeScore: 4, awayScore: 1, liveDetail: undefined })
  })

  it("maps an upcoming event with no scores and a live event with a phase label", async () => {
    const { snapshot: s } = await snapshot()
    const upcoming = s.matches.find((x) => x.externalId === "2494047")
    assert.equal(upcoming?.status, "upcoming")
    assert.equal(upcoming?.homeScore, undefined)
    assert.equal(upcoming?.awayScore, undefined)
    const live = s.matches.find((x) => x.externalId === "2494049")
    assert.equal(live?.status, "live")
    assert.equal(live?.liveDetail, "Half time")
    assert.deepEqual([live?.homeScore, live?.awayScore], [1, 0])
  })

  it("collects venues from events by idVenue", async () => {
    const { snapshot: s } = await snapshot()
    assert.deepEqual(s.venues.map((v) => `${v.externalId}:${v.name}:${v.country}`).sort(), ["15528:Emirates Stadium:England", "15533:Stamford Bridge:England", "15534:Elland Road:England", "16294:St James' Park:England", "18332:Old Trafford:England", "18406:Brentford Community Stadium:England"])
  })

  it("isolates malformed events as record-level errors and keeps the rest", async () => {
    const { snapshot: s } = await snapshot({ days: { "2026-09-16": [broken.noTime, broken.noTeams, broken.sameTeam, dayEvents["2026-09-16"][0]] } })
    const errors = s.issues.filter((i) => i.level === "error").map((i) => i.externalId)
    assert.deepEqual(errors.sort(), ["9000001", "9000002", "9000008"])
    assert.ok(s.matches.some((m) => m.externalId === "2494030"))
    assert.ok(!s.matches.some((m) => /^90000/.test(m.externalId)))
  })

  it("skips events from another league or another season with a warning", async () => {
    const { snapshot: s } = await snapshot({ days: { "2026-09-16": [broken.otherLeague, broken.otherSeason] } })
    assert.ok(s.issues.some((i) => i.level === "warning" && i.externalId === "9000006" && /league 4335/.test(i.message)))
    assert.ok(s.issues.some((i) => i.level === "warning" && i.externalId === "9000007" && /season "2025-2026"/.test(i.message)))
    assert.ok(!s.matches.some((m) => m.externalId === "9000006" || m.externalId === "9000007"))
  })

  it("passes a lone score through so the sync core drops the pair with its own warning", async () => {
    const { snapshot: s } = await snapshot({ days: { "2026-09-16": [broken.loneScore] } })
    const m = s.matches.find((x) => x.externalId === "9000005")
    assert.deepEqual([m?.homeScore, m?.awayScore], [2, undefined])
  })

  it("is deterministic for the same input", async () => {
    const a = await snapshot()
    const b = await snapshot()
    assert.deepEqual(b.snapshot, a.snapshot)
  })
})

describe("status mapping", () => {
  it("maps the observed and documented football codes", () => {
    assert.equal(STATUS_MAP.NS, "upcoming")
    assert.equal(STATUS_MAP.FT, "finished")
    for (const code of ["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"]) assert.equal(STATUS_MAP[code], "live", code)
    for (const code of ["AET", "PEN"]) assert.equal(STATUS_MAP[code], "finished", code)
  })

  it("never guesses: postponed, cancelled, abandoned, empty and unknown codes are unknown with a warning", async () => {
    const abandoned: RawEvent = { ...broken.cancelled, idEvent: "9000009", strStatus: "ABD" }
    const empty: RawEvent = { ...broken.cancelled, idEvent: "9000010", strStatus: "" }
    const nul: RawEvent = { ...broken.cancelled, idEvent: "9000011", strStatus: null }
    const tbd: RawEvent = { ...broken.cancelled, idEvent: "9000012", strStatus: "TBD" }
    const { snapshot: s } = await snapshot({ days: { "2026-09-16": [broken.postponed, broken.cancelled, abandoned, empty, nul, tbd] } })
    for (const id of ["9000003", "9000004", "9000009", "9000010", "9000011", "9000012"]) {
      const m = s.matches.find((x) => x.externalId === id)
      assert.equal(m?.status, "unknown", id)
      assert.ok(s.issues.some((i) => i.level === "warning" && i.externalId === id), `${id} warned`)
    }
    assert.ok(s.issues.some((i) => i.externalId === "9000003" && /postponed/.test(i.message)))
    assert.ok(!s.matches.some((m) => /^90000/.test(m.externalId) && m.status === "finished"))
  })
})

describe("timestamps", () => {
  it("treats the zone-less strTimestamp as UTC", () => {
    assert.equal(toInstant({ strTimestamp: "2026-09-18T19:00:00" }), "2026-09-18T19:00:00.000Z")
  })

  it("respects an explicit zone if the feed ever sends one", () => {
    assert.equal(toInstant({ strTimestamp: "2026-09-18T20:00:00+01:00" }), "2026-09-18T19:00:00.000Z")
  })

  it("falls back to dateEvent + strTime, also UTC", () => {
    assert.equal(toInstant({ strTimestamp: null, dateEvent: "2026-09-18", strTime: "19:00:00" }), "2026-09-18T19:00:00.000Z")
  })

  it("yields nothing for missing or malformed values instead of guessing midnight", () => {
    assert.equal(toInstant({ strTimestamp: null, dateEvent: "2026-09-18", strTime: null }), undefined)
    assert.equal(toInstant({ strTimestamp: "yesterday" }), undefined)
    assert.equal(toInstant({ strTimestamp: "2026-13-40T99:00:00" }), undefined)
    assert.equal(toInstant({}), undefined)
  })

  it("the local-time pair in the fixtures is one hour later than the UTC pair (British Summer Time), which is the evidence for UTC", () => {
    assert.equal(nextEvent.strTime, "19:00:00")
    assert.equal(nextEvent.strTimeLocal, "20:00:00")
    assert.equal(pastEvent.strTimeLocal, "20:00:00")
  })
})

describe("failure handling", () => {
  it("a network failure propagates unchanged so the sync core classifies it", async () => {
    const { provider: p } = provider({ fail: { "lookupleague.php": new TypeError("fetch failed") } })
    await assert.rejects(p.fetch(context), /fetch failed/)
  })

  it("HTTP 429, 4xx and 5xx propagate as HttpError with their status", async () => {
    for (const status of [429, 404, 500, 503]) {
      const { provider: p } = provider({ fail: { "eventsseason.php": new HttpError(status, "https://api.example.test/v1/json/123/eventsseason.php?id=4328") } })
      await assert.rejects(p.fetch(context), (e: unknown) => e instanceof HttpError && e.status === status)
    }
  })

  it("malformed JSON is a MalformedResponseError", async () => {
    const { provider: p } = provider({ fail: { "lookupleague.php": new MalformedResponseError("https://api.example.test/x", "invalid JSON") } })
    await assert.rejects(p.fetch(context), (e: unknown) => e instanceof MalformedResponseError)
  })

  it("valid JSON with a missing or null collection is an empty list, not a crash", async () => {
    const { snapshot: s } = await snapshot({ teams: {}, season: { events: null }, next: { nothing: true }, past: { events: null }, days: {} })
    assert.deepEqual(s.matches, [])
    assert.ok(s.teams.length >= 0)
    assert.equal(s.leagues.length, 1)
  })

  it("a custom key is scrubbed from transport error messages", async () => {
    const { provider: p } = provider({ fail: { "lookupleague.php": new Error("HTTP 500 from https://api.example.test/v1/json/s3cret-key/lookupleague.php?id=4328") } }, configured({ apiKey: "s3cret-key" }))
    await assert.rejects(p.fetch(context), (e: unknown) => e instanceof Error && !e.message.includes("s3cret-key") && e.message.includes("REDACTED"))
  })

  it("a lookup that returns nothing keeps the team from event data with a warning", async () => {
    const { snapshot: s } = await snapshot({ lookups: { "133635": teamList[0] } })
    assert.ok(s.issues.some((i) => i.entity === "team" && i.externalId === "134777" && /returned nothing/.test(i.message)))
    assert.ok(s.teams.some((t) => t.externalId === "134777" && t.name === "Newcastle United"))
  })
})

describe("other providers", () => {
  it("the Sportradar and mock providers are still registered and unaffected", async () => {
    assert.equal(resolveProvider("ds-tennis-sportradar")?.key, "sportradar-tennis")
    const raw = await mockBasketballProvider.fetch({ dataSourceId: "ds-mock-basketball", now: new Date("2026-09-17T12:00:00Z") })
    const s = mockBasketballProvider.normalize(raw, { dataSourceId: "ds-mock-basketball", now: new Date("2026-09-17T12:00:00Z") })
    assert.equal(s.matches.length, 9)
    assert.equal(seasonEvents.length, 2)
  })
})
