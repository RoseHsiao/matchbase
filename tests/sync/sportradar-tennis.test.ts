import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { mockBasketballProvider } from "../../lib/data/sync/providers/mock-basketball"
import { dataSourceProviders, providers, resolveProvider } from "../../lib/data/sync/providers/registry"
import {
  createSportradarTennisProvider,
  displayName,
  leagueShortName,
  readSportradarTennisConfig,
  type JsonRequest,
  type RawSummary,
  type SportradarTennisConfig,
  type SportradarTennisPayload,
} from "../../lib/data/sync/providers/sportradar-tennis"
import { ProviderConfigurationError, type SyncContext } from "../../lib/data/sync/types"
import { HttpError } from "../../lib/data/sync/utils/http"

// ---------------------------------------------------------------------------
// Fixtures shaped like the documented Sportradar Tennis v3 responses
// ---------------------------------------------------------------------------

const NOW = new Date("2026-07-05T12:00:00Z")
const context: SyncContext = { dataSourceId: "ds-tennis-sportradar", now: NOW }

const competitions = [
  { id: "sr:competition:2555", name: "Wimbledon Men Singles", parent_id: "sr:competition:2553", type: "singles", gender: "men", level: "grand_slam", category: { id: "sr:category:3", name: "ATP" } },
  { id: "sr:competition:2556", name: "Wimbledon Women Doubles", parent_id: "sr:competition:2553", type: "doubles", gender: "women", level: "grand_slam", category: { id: "sr:category:6", name: "WTA" } },
  { id: "sr:competition:2557", name: "Wimbledon Mixed Doubles", parent_id: "sr:competition:2553", type: "mixed_doubles", gender: "mixed", level: "grand_slam", category: { id: "sr:category:3", name: "ATP" } },
  { id: "sr:competition:9001", name: "ATP Halle, Germany Men Singles", type: "singles", gender: "men", level: "atp_500", category: { id: "sr:category:3", name: "ATP" } },
  { id: "sr:competition:2553", name: "Wimbledon", type: "", gender: "", level: "grand_slam", category: { id: "sr:category:3", name: "ATP" } },
]

const seasonsByCompetition: Record<string, unknown[]> = {
  "sr:competition:2555": [
    { id: "sr:season:120983", name: "Wimbledon Men Singles 2025", start_date: "2025-06-23", end_date: "2025-07-13", year: "2025", competition_id: "sr:competition:2555" },
    { id: "sr:season:130001", name: "Wimbledon Men Singles 2026", start_date: "2026-06-29", end_date: "2026-07-12", year: "2026", competition_id: "sr:competition:2555" },
  ],
  "sr:competition:2556": [{ id: "sr:season:130002", name: "Wimbledon Women Doubles 2026", start_date: "2026-06-29", end_date: "2026-07-12", year: "2026", competition_id: "sr:competition:2556" }],
  "sr:competition:2557": [{ id: "sr:season:130003", name: "Wimbledon Mixed Doubles 2026", start_date: "2026-06-29", end_date: "2026-07-12", year: "2026", competition_id: "sr:competition:2557", disabled: true }],
}

const singlesClosed: RawSummary = {
  sport_event: {
    id: "sr:sport_event:50001",
    start_time: "2026-07-04T13:00:00+00:00",
    sport_event_context: {
      competition: { id: "sr:competition:2555", name: "Wimbledon Men Singles", type: "singles", gender: "men" },
      season: { id: "sr:season:130001", name: "Wimbledon Men Singles 2026", year: "2026" },
      round: { name: "quarterfinal" },
      mode: { best_of: 5 },
    },
    competitors: [
      { id: "sr:competitor:14882", name: "Djokovic, Novak", country: "Serbia", country_code: "SRB", abbreviation: "DJO", qualifier: "home", type: "singles", seed: 2 },
      { id: "sr:competitor:407573", name: "Alcaraz, Carlos", country: "Spain", country_code: "ESP", abbreviation: "ALC", qualifier: "away", type: "singles", seed: 3 },
    ],
    venue: { id: "sr:venue:1234", name: "Centre Court", city_name: "London", country_name: "England", capacity: 14979 },
  },
  sport_event_status: { status: "closed", match_status: "ended", home_score: 1, away_score: 3, winner_id: "sr:competitor:407573" },
}

const doublesLive: RawSummary = {
  sport_event: {
    id: "sr:sport_event:50002",
    start_time: "2026-07-05T11:00:00+00:00",
    sport_event_context: {
      competition: { id: "sr:competition:2556", name: "Wimbledon Women Doubles", type: "doubles", gender: "women" },
      season: { id: "sr:season:130002", name: "Wimbledon Women Doubles 2026", year: "2026" },
      round: { name: "semifinal" },
    },
    competitors: [
      // Provider lists away first here on purpose: side order must follow the qualifier, not array order.
      { id: "sr:competitor:900002", name: "Hsieh S / Ostapenko J", abbreviation: "H/O", qualifier: "away", type: "doubles", players: [{ id: "sr:competitor:38516", name: "Hsieh, Su-Wei" }, { id: "sr:competitor:36208", name: "Ostapenko, Jelena" }] },
      { id: "sr:competitor:900001", name: "Siniakova K / Townsend T", abbreviation: "S/T", qualifier: "home", type: "doubles", players: [{ id: "sr:competitor:53880", name: "Siniakova, Katerina" }, { id: "sr:competitor:51424", name: "Townsend, Taylor" }] },
    ],
  },
  sport_event_status: { status: "live", match_status: "2nd_set", home_score: 1, away_score: 0 },
}

const cancelled: RawSummary = {
  sport_event: {
    id: "sr:sport_event:50003",
    start_time: "2026-07-06T10:00:00+00:00",
    sport_event_context: { competition: { id: "sr:competition:2555" }, season: { id: "sr:season:130001" }, round: { name: "round_of_16" } },
    competitors: [
      { id: "sr:competitor:1", name: "Player, One", qualifier: "home", type: "singles" },
      { id: "sr:competitor:2", name: "Player, Two", qualifier: "away", type: "singles" },
    ],
  },
  sport_event_status: { status: "cancelled" },
}

const broken: RawSummary = {
  sport_event: {
    id: "sr:sport_event:50004",
    start_time: "2026-07-06T10:00:00+00:00",
    sport_event_context: { competition: { id: "sr:competition:2556" }, season: { id: "sr:season:130002" } },
    competitors: [{ id: "sr:competitor:900009", name: "Unknown pair", qualifier: "home", type: "doubles", players: [] }],
  },
  sport_event_status: { status: "not_started" },
}

const payload: SportradarTennisPayload = {
  competitions: competitions.filter((c) => c.level === "grand_slam" && ["singles", "doubles", "mixed_doubles"].includes(c.type)),
  seasons: [seasonsByCompetition["sr:competition:2555"][1], seasonsByCompetition["sr:competition:2556"][0]] as SportradarTennisPayload["seasons"],
  summaries: [singlesClosed, doublesLive, cancelled, broken],
}

function configured(overrides: Partial<SportradarTennisConfig> = {}): () => SportradarTennisConfig {
  return () => ({ apiKey: "test-key", accessLevel: "trial", baseUrl: "https://api.example.test/tennis", language: "en", levels: ["grand_slam"], requestIntervalMs: 0, ...overrides })
}

/** In-memory Sportradar: competitions, per-competition seasons, and paginated summaries with X-Max-Results. */
function fakeApi(summariesBySeason: Record<string, RawSummary[]>, pageSize = 200) {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const request: JsonRequest = async <T>(url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers })
    const respond = (body: unknown, headers: Record<string, string> = {}) => ({ body: body as T, headers: new Headers(headers) })
    const u = new URL(url)
    if (u.pathname.endsWith("/competitions.json")) return respond({ competitions })
    const seasonsMatch = u.pathname.match(/\/competitions\/([^/]+)\/seasons\.json$/)
    if (seasonsMatch) return respond({ seasons: seasonsByCompetition[decodeURIComponent(seasonsMatch[1])] ?? [] })
    const summariesMatch = u.pathname.match(/\/seasons\/([^/]+)\/summaries\.json$/)
    if (summariesMatch) {
      const all = summariesBySeason[decodeURIComponent(summariesMatch[1])] ?? []
      const start = Number(u.searchParams.get("start") ?? 0)
      const limit = Math.min(Number(u.searchParams.get("limit") ?? 200), pageSize)
      return respond({ summaries: all.slice(start, start + limit) }, { "x-max-results": String(all.length) })
    }
    throw new HttpError(404, url)
  }
  return { request, calls }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("registry", () => {
  it("registers the tennis provider next to the mock basketball provider", () => {
    assert.equal(providers["sportradar-tennis"]?.sport, "tennis")
    assert.equal(providers[mockBasketballProvider.key]?.sport, "basketball")
  })
  it("binds the seeded tennis data source to the provider", () => {
    assert.equal(dataSourceProviders["ds-tennis-sportradar"], "sportradar-tennis")
    assert.equal(resolveProvider("ds-tennis-sportradar")?.key, "sportradar-tennis")
    assert.equal(resolveProvider("ds-mock-basketball")?.key, "mock-basketball")
    assert.equal(resolveProvider("ds-manual"), undefined)
  })
})

describe("configuration", () => {
  it("reads environment variables with safe defaults", () => {
    const config = readSportradarTennisConfig({ SPORTRADAR_API_KEY: " k ", SPORTRADAR_TENNIS_LEVELS: "grand_slam, atp_1000", SPORTRADAR_TENNIS_SEASON_YEAR: "2025" })
    assert.equal(config.apiKey, "k")
    assert.equal(config.accessLevel, "trial")
    assert.equal(config.baseUrl, "https://api.sportradar.com/tennis")
    assert.deepEqual(config.levels, ["grand_slam", "atp_1000"])
    assert.equal(config.year, 2025)
  })
  it("fails explicitly without an API key and makes no request", async () => {
    const api = fakeApi({})
    const provider = createSportradarTennisProvider({ config: configured({ apiKey: undefined }), request: api.request })
    await assert.rejects(provider.fetch(context), (error: unknown) => error instanceof ProviderConfigurationError && /SPORTRADAR_API_KEY/.test(error.message))
    assert.equal(api.calls.length, 0)
  })
  it("turns HTTP 403 into a configuration error instead of a retry", async () => {
    const request: JsonRequest = async (url) => { throw new HttpError(403, url) }
    const provider = createSportradarTennisProvider({ config: configured(), request })
    await assert.rejects(provider.fetch(context), (error: unknown) => error instanceof ProviderConfigurationError && /HTTP 403/.test(error.message))
  })
})

describe("fetch", () => {
  it("selects Grand Slam singles, doubles and mixed competitions, the target year's seasons, and pages summaries", async () => {
    const summaries = Array.from({ length: 5 }, (_, i) => ({ ...singlesClosed, sport_event: { ...singlesClosed.sport_event, id: `sr:sport_event:${i}` } }))
    const api = fakeApi({ "sr:season:130001": summaries, "sr:season:130002": [doublesLive] }, 2)
    const provider = createSportradarTennisProvider({ config: configured(), request: api.request })
    const raw = await provider.fetch(context)
    assert.deepEqual(raw.competitions.map((c) => c.id), ["sr:competition:2555", "sr:competition:2556", "sr:competition:2557"])
    assert.deepEqual(raw.seasons.map((s) => s.id), ["sr:season:130001", "sr:season:130002"], "2025 season and the disabled mixed season are skipped")
    assert.equal(raw.summaries.length, 6)
    assert.equal(api.calls.filter((c) => c.url.includes("sr:season:130001/summaries")).length, 3, "5 rows at page size 2 = 3 pages")
    assert.ok(api.calls.every((c) => c.headers["x-api-key"] === "test-key"), "key travels in the header, never the URL")
    assert.ok(api.calls.every((c) => !c.url.includes("test-key")))
  })
  it("honours an explicit competition list over levels", async () => {
    const api = fakeApi({})
    const provider = createSportradarTennisProvider({ config: configured({ competitionIds: ["sr:competition:9001"] }), request: api.request })
    const raw = await provider.fetch(context)
    assert.deepEqual(raw.competitions.map((c) => c.id), ["sr:competition:9001"])
  })
})

describe("normalize", () => {
  const provider = createSportradarTennisProvider({ config: configured() })
  const snapshot = provider.normalize(payload, context)

  it("maps Grand Slam competitions to tennis leagues with stable short names", () => {
    assert.deepEqual(snapshot.leagues.map((l) => [l.externalId, l.sport, l.shortName, l.region]), [
      ["sr:competition:2555", "tennis", "Wimbledon MS", "ATP"],
      ["sr:competition:2556", "tennis", "Wimbledon WD", "WTA"],
      ["sr:competition:2557", "tennis", "Wimbledon XD", "ATP"],
    ])
    assert.equal(leagueShortName({ id: "x", name: "Australian Open Men Doubles", type: "doubles", gender: "men" }), "Australian Open MD")
  })
  it("maps seasons by year with a date-derived status", () => {
    assert.deepEqual(snapshot.seasons.map((s) => [s.externalId, s.leagueExternalId, s.name, s.status]), [
      ["sr:season:130001", "sr:competition:2555", "2026", "current"],
      ["sr:season:130002", "sr:competition:2556", "2026", "current"],
    ])
  })
  it("emits players with provider ids, no team, and display-ordered names", () => {
    const byId = new Map(snapshot.players.map((p) => [p.externalId, p]))
    assert.equal(byId.get("sr:competitor:14882")?.name, "Novak Djokovic")
    assert.equal(byId.get("sr:competitor:14882")?.nationality, "Serbia")
    assert.equal(byId.get("sr:competitor:14882")?.teamExternalId, undefined)
    assert.equal(byId.get("sr:competitor:38516")?.name, "Su-Wei Hsieh")
    assert.equal(displayName("Alcaraz, Carlos"), "Carlos Alcaraz")
    assert.equal(displayName("Single"), "Single")
    assert.equal(snapshot.teams.length, 0, "no team is ever invented for a player")
    assert.equal(snapshot.matches.length, 0, "no team-vs-team match is produced")
  })
  it("normalizes a singles match into two one-player sides with aggregate set scores", () => {
    const match = snapshot.individualMatches?.find((m) => m.externalId === "sr:sport_event:50001")
    assert.ok(match)
    assert.equal(match.leagueExternalId, "sr:competition:2555")
    assert.equal(match.seasonExternalId, "sr:season:130001")
    assert.equal(match.venueExternalId, "sr:venue:1234")
    assert.equal(match.startsAt, "2026-07-04T13:00:00+00:00")
    assert.equal(match.status, "finished")
    assert.equal(match.stage, "Quarterfinal")
    assert.deepEqual(match.sides[0], { participants: [{ kind: "player", externalId: "sr:competitor:14882" }], score: 1 })
    assert.deepEqual(match.sides[1], { participants: [{ kind: "player", externalId: "sr:competitor:407573" }], score: 3 })
  })
  it("keeps both players on each doubles side, ordered by the home qualifier, with live detail", () => {
    const match = snapshot.individualMatches?.find((m) => m.externalId === "sr:sport_event:50002")
    assert.ok(match)
    assert.equal(match.status, "live")
    assert.equal(match.liveDetail, "Set 2")
    assert.deepEqual(match.sides[0].participants, [{ kind: "player", externalId: "sr:competitor:53880" }, { kind: "player", externalId: "sr:competitor:51424" }])
    assert.deepEqual(match.sides[1].participants, [{ kind: "player", externalId: "sr:competitor:38516" }, { kind: "player", externalId: "sr:competitor:36208" }])
    assert.equal(match.sides[0].score, 1)
    assert.equal(match.sides[1].score, 0)
    assert.equal(snapshot.players.filter((p) => ["sr:competitor:53880", "sr:competitor:51424", "sr:competitor:38516", "sr:competitor:36208"].includes(p.externalId)).length, 4)
  })
  it("never maps an unknown or cancelled status to finished and records a warning", () => {
    const match = snapshot.individualMatches?.find((m) => m.externalId === "sr:sport_event:50003")
    assert.equal(match?.status, "unknown")
    assert.equal(match?.rawStatus, "cancelled")
    assert.ok(snapshot.issues.some((i) => i.level === "warning" && i.externalId === "sr:sport_event:50003" && /cancelled/.test(i.message)))
  })
  it("drops a malformed event as a record-level error without losing the others", () => {
    assert.ok(snapshot.issues.some((i) => i.level === "error" && i.externalId === "sr:sport_event:50004"))
    assert.deepEqual(snapshot.individualMatches?.map((m) => m.externalId), ["sr:sport_event:50001", "sr:sport_event:50002", "sr:sport_event:50003"])
  })
  it("collects venues once", () => {
    assert.deepEqual(snapshot.venues, [{ externalId: "sr:venue:1234", name: "Centre Court", city: "London", country: "England", capacity: 14979 }])
  })
  it("is deterministic for the same input (idempotent sync input)", () => {
    assert.deepEqual(provider.normalize(payload, context), snapshot)
  })
})

describe("existing basketball provider regression", () => {
  it("still normalizes team matches with no individual matches", async () => {
    const raw = await mockBasketballProvider.fetch({ dataSourceId: "ds-mock-basketball", now: NOW })
    const snapshot = mockBasketballProvider.normalize(raw, { dataSourceId: "ds-mock-basketball", now: NOW })
    assert.equal(snapshot.matches.length, 9)
    assert.equal(snapshot.individualMatches, undefined)
    assert.ok(snapshot.players.every((p) => p.teamExternalId !== undefined))
  })
})
