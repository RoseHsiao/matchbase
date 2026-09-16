import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { mockBasketballProvider } from "../../lib/data/sync/providers/mock-basketball"
import { dataSourceProviders, providers, resolveProvider } from "../../lib/data/sync/providers/registry"
import {
  createSportradarTennisProvider,
  displayName,
  leagueShortName,
  MAX_PAGES_PER_SEASON,
  readSportradarTennisConfig,
  STATUS_MAP,
  toInstant,
  validateSportradarTennisConfig,
  type JsonRequest,
  type RawSummary,
} from "../../lib/data/sync/providers/sportradar-tennis"
import { ProviderConfigurationError } from "../../lib/data/sync/types"
import { HttpError } from "../../lib/data/sync/utils/http"

import { broken, competitions, configured, context, doublesLive, fakeApi, NOW, payload, seasonsByCompetition, singlesClosed } from "./fixtures/sportradar-tennis"

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
    assert.equal(match.startsAt, "2026-07-04T13:00:00.000Z")
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

describe("configuration validation (Phase 7)", () => {
  it("reports every problem in one message without the key's value", () => {
    const result = validateSportradarTennisConfig({ apiKey: undefined, accessLevel: "gold", baseUrl: "ftp://x", language: "english", year: 1900, levels: [], requestIntervalMs: -1 })
    assert.equal(result.configured, false)
    if (!result.configured) {
      for (const fragment of ["SPORTRADAR_API_KEY is not set", "ACCESS_LEVEL", "BASE_URL", "LANGUAGE", "SEASON_YEAR", "LEVELS", "REQUEST_INTERVAL_MS"]) assert.match(result.error, new RegExp(fragment))
    }
  })
  it("accepts a complete configuration and the provider reports itself ready", () => {
    assert.deepEqual(validateSportradarTennisConfig(configured()()), { configured: true })
    const provider = createSportradarTennisProvider({ config: configured() })
    assert.equal(provider.kind, "live")
    assert.deepEqual(provider.checkConfiguration?.(), { configured: true })
  })
  it("the registered provider reads the real environment and is not configured here", () => {
    const status = validateSportradarTennisConfig(readSportradarTennisConfig({}))
    assert.equal(status.configured, false)
    if (!status.configured) assert.doesNotMatch(status.error, /test-key/)
  })
  it("turns HTTP 401 into a configuration error too", async () => {
    const request: JsonRequest = async (url) => { throw new HttpError(401, url) }
    const provider = createSportradarTennisProvider({ config: configured(), request })
    await assert.rejects(provider.fetch(context), (error: unknown) => error instanceof ProviderConfigurationError && /HTTP 401/.test(error.message))
  })
  it("never lets the API key into an error message, even if the transport puts it there", async () => {
    const request: JsonRequest = async () => { throw new Error("upstream said: bad key test-key in request") }
    const provider = createSportradarTennisProvider({ config: configured(), request })
    await assert.rejects(provider.fetch(context), (error: unknown) => error instanceof Error && !error.message.includes("test-key") && /REDACTED/.test(error.message))
  })
  it("propagates transient transport failures unchanged so the service can classify them", async () => {
    for (const status of [429, 503]) {
      const request: JsonRequest = async (url) => { throw new HttpError(status, url) }
      const provider = createSportradarTennisProvider({ config: configured(), request })
      await assert.rejects(provider.fetch(context), (error: unknown) => error instanceof HttpError && error.status === status)
    }
  })
  it("treats a non-object body as an error", async () => {
    const request: JsonRequest = async <T,>() => ({ body: "nope" as T, headers: new Headers() })
    const provider = createSportradarTennisProvider({ config: configured(), request })
    await assert.rejects(provider.fetch(context), /non-object body/)
  })
})

describe("pagination (Phase 7)", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ ...singlesClosed, sport_event: { ...singlesClosed.sport_event, id: `sr:sport_event:${1000 + i}` } }))
  const pagesRequested = (calls: { url: string }[]) => calls.filter((c) => c.url.includes("sr:season:130001/summaries")).map((c) => new URL(c.url).searchParams.get("start"))
  const onlyMenSingles = configured({ competitionIds: ["sr:competition:2555"] })

  it("one page: a single request when the total fits", async () => {
    const api = fakeApi({ "sr:season:130001": rows(3) })
    const raw = await createSportradarTennisProvider({ config: onlyMenSingles, request: api.request }).fetch(context)
    assert.equal(raw.summaries.length, 3)
    assert.deepEqual(pagesRequested(api.calls), ["0"])
  })
  it("multiple pages: follows start/limit until X-Max-Results is reached, in order", async () => {
    const api = fakeApi({ "sr:season:130001": rows(7) }, 3)
    const raw = await createSportradarTennisProvider({ config: onlyMenSingles, request: api.request }).fetch(context)
    assert.deepEqual(raw.summaries.map((s) => s.sport_event.id), rows(7).map((s) => s.sport_event.id))
    assert.deepEqual(pagesRequested(api.calls), ["0", "3", "6"])
  })
  it("final page: an exact multiple of the page size does not request an extra empty page", async () => {
    const api = fakeApi({ "sr:season:130001": rows(6) }, 3)
    await createSportradarTennisProvider({ config: onlyMenSingles, request: api.request }).fetch(context)
    assert.deepEqual(pagesRequested(api.calls), ["0", "3"])
  })
  it("empty page: a season with no events makes one request and stops", async () => {
    const api = fakeApi({ "sr:season:130001": [] })
    const raw = await createSportradarTennisProvider({ config: onlyMenSingles, request: api.request }).fetch(context)
    assert.equal(raw.summaries.length, 0)
    assert.deepEqual(pagesRequested(api.calls), ["0"])
  })
  it("malformed pagination metadata: a garbage X-Max-Results falls back to page-size detection", async () => {
    const calls: string[] = []
    const request: JsonRequest = async <T,>(url: string) => {
      calls.push(url)
      const u = new URL(url)
      if (u.pathname.endsWith("competitions.json")) return { body: { competitions } as T, headers: new Headers() }
      if (u.pathname.includes("/seasons.json")) return { body: { seasons: seasonsByCompetition["sr:competition:2555"] } as T, headers: new Headers() }
      const start = Number(u.searchParams.get("start"))
      // 200 rows on the first page (a full page), 5 on the second, then nothing.
      const body = { summaries: start === 0 ? rows(200) : start === 200 ? rows(5) : [] }
      return { body: body as T, headers: new Headers({ "x-max-results": "not-a-number" }) }
    }
    const raw = await createSportradarTennisProvider({ config: onlyMenSingles, request }).fetch(context)
    assert.equal(raw.summaries.length, 205)
    assert.deepEqual(calls.filter((c) => c.includes("summaries")).map((c) => new URL(c).searchParams.get("start")), ["0", "200"])
  })
  it("a header claiming more rows than exist cannot loop: an empty page ends the season", async () => {
    let served = 0
    const request: JsonRequest = async <T,>(url: string) => {
      const u = new URL(url)
      if (u.pathname.endsWith("competitions.json")) return { body: { competitions } as T, headers: new Headers() }
      if (u.pathname.includes("/seasons.json")) return { body: { seasons: seasonsByCompetition["sr:competition:2555"] } as T, headers: new Headers() }
      served++
      return { body: { summaries: served === 1 ? rows(2) : [] } as T, headers: new Headers({ "x-max-results": "999999" }) }
    }
    const raw = await createSportradarTennisProvider({ config: onlyMenSingles, request }).fetch(context)
    assert.equal(raw.summaries.length, 2)
    assert.equal(served, 2)
  })
  it("a server that always returns a full page is cut off at the page cap", async () => {
    let served = 0
    const request: JsonRequest = async <T,>(url: string) => {
      const u = new URL(url)
      if (u.pathname.endsWith("competitions.json")) return { body: { competitions } as T, headers: new Headers() }
      if (u.pathname.includes("/seasons.json")) return { body: { seasons: seasonsByCompetition["sr:competition:2555"] } as T, headers: new Headers() }
      served++
      return { body: { summaries: rows(200) } as T, headers: new Headers({ "x-max-results": "999999" }) }
    }
    await createSportradarTennisProvider({ config: onlyMenSingles, request }).fetch(context)
    assert.equal(served, MAX_PAGES_PER_SEASON)
  })
  it("a missing summaries array is an empty page, not a crash", async () => {
    const request: JsonRequest = async <T,>(url: string) => {
      const u = new URL(url)
      if (u.pathname.endsWith("competitions.json")) return { body: { competitions } as T, headers: new Headers() }
      if (u.pathname.includes("/seasons.json")) return { body: { seasons: seasonsByCompetition["sr:competition:2555"] } as T, headers: new Headers() }
      return { body: { summaries: "garbage" } as T, headers: new Headers() }
    }
    const raw = await createSportradarTennisProvider({ config: onlyMenSingles, request }).fetch(context)
    assert.equal(raw.summaries.length, 0)
  })
})

describe("status mapping (Phase 7)", () => {
  const provider = createSportradarTennisProvider({ config: configured() })
  const withStatus = (status: string): RawSummary => ({ ...singlesClosed, sport_event: { ...singlesClosed.sport_event, id: `sr:sport_event:${status}` }, sport_event_status: { status, home_score: 1, away_score: 0 } })
  const normalizedStatus = (status: string) => provider.normalize({ ...payload, summaries: [withStatus(status)] }, context).individualMatches?.[0]?.status

  it("maps every documented provider status", () => {
    const expected: Record<string, string> = { not_started: "upcoming", match_about_to_start: "upcoming", delayed: "upcoming", started: "live", live: "live", interrupted: "live", ended: "finished", closed: "finished" }
    assert.deepEqual(STATUS_MAP, expected)
    for (const [raw, status] of Object.entries(expected)) assert.equal(normalizedStatus(raw), status, raw)
  })
  it("keeps cancelled, postponed, suspended, abandoned, retired, walkover and unknown values out of finished", () => {
    for (const raw of ["cancelled", "postponed", "suspended", "abandoned", "retired", "walkover", "", "something_new"]) {
      const snapshot = provider.normalize({ ...payload, summaries: [withStatus(raw)] }, context)
      assert.equal(snapshot.individualMatches?.[0]?.status, "unknown", raw)
      assert.ok(snapshot.issues.some((i) => i.level === "warning" && /Unmapped provider status/.test(i.message)), `${raw} records a warning`)
    }
  })
})

describe("timezone handling (Phase 7)", () => {
  it("normalizes offset instants to UTC without changing the moment", () => {
    assert.equal(toInstant("2026-07-04T15:00:00+02:00"), "2026-07-04T13:00:00.000Z")
    assert.equal(toInstant("2026-07-04T13:00:00+00:00"), "2026-07-04T13:00:00.000Z")
    assert.equal(toInstant("2026-07-04T08:00:00-05:00"), "2026-07-04T13:00:00.000Z")
    assert.equal(toInstant("2026-07-04T13:00:00Z"), "2026-07-04T13:00:00.000Z")
    assert.equal(toInstant("yesterday"), undefined)
    assert.equal(toInstant(undefined), undefined)
  })
  it("a match reported in a local offset is stored as the same absolute instant", () => {
    const provider = createSportradarTennisProvider({ config: configured() })
    const local: RawSummary = { ...singlesClosed, sport_event: { ...singlesClosed.sport_event, id: "sr:sport_event:tz", start_time: "2026-07-04T15:00:00+02:00" } }
    const match = provider.normalize({ ...payload, summaries: [local] }, context).individualMatches?.[0]
    assert.equal(match?.startsAt, "2026-07-04T13:00:00.000Z")
    assert.equal(new Date(match?.startsAt ?? "").getTime(), Date.UTC(2026, 6, 4, 13, 0, 0))
  })
  it("an unparseable start time fails that record only", () => {
    const provider = createSportradarTennisProvider({ config: configured() })
    const bad: RawSummary = { ...singlesClosed, sport_event: { ...singlesClosed.sport_event, id: "sr:sport_event:bad", start_time: "not a time" } }
    const snapshot = provider.normalize({ ...payload, summaries: [bad, doublesLive] }, context)
    assert.deepEqual(snapshot.individualMatches?.map((m) => m.externalId), ["sr:sport_event:50002"])
    assert.ok(snapshot.issues.some((i) => i.level === "error" && i.externalId === "sr:sport_event:bad" && /Invalid start time/.test(i.message)))
  })
  it("a summary without a sport_event is reported, not thrown", () => {
    const provider = createSportradarTennisProvider({ config: configured() })
    const snapshot = provider.normalize({ ...payload, summaries: [{} as RawSummary, broken] }, context)
    assert.equal(snapshot.individualMatches?.length, 0)
    assert.equal(snapshot.issues.filter((i) => i.level === "error").length, 2)
  })
})

describe("scores (Phase 7)", () => {
  it("keeps only the aggregate sets-won pair; per-set game scores are not modelled", () => {
    const provider = createSportradarTennisProvider({ config: configured() })
    const withSets = { ...singlesClosed, sport_event_status: { ...singlesClosed.sport_event_status, period_scores: [{ home_score: 6, away_score: 4 }, { home_score: 3, away_score: 6 }] } } as RawSummary
    const match = provider.normalize({ ...payload, summaries: [withSets] }, context).individualMatches?.[0]
    assert.deepEqual(match?.sides.map((s) => s.score), [1, 3])
    assert.equal(Object.keys(match ?? {}).includes("periodScores"), false)
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
