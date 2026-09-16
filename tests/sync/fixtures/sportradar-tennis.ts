/**
 * Deterministic fixtures shaped like the documented Sportradar Tennis v3
 * responses, plus an in-memory transport that serves them with pagination.
 * Used by the provider tests and the database pipeline test. Test-only:
 * production code never imports this module.
 */
import {
  type JsonRequest,
  type RawSummary,
  type SportradarTennisConfig,
  type SportradarTennisPayload,
} from "../../../lib/data/sync/providers/sportradar-tennis"
import type { SyncContext } from "../../../lib/data/sync/types"
import { HttpError } from "../../../lib/data/sync/utils/http"

export const NOW = new Date("2026-07-05T12:00:00Z")
export const context: SyncContext = { dataSourceId: "ds-tennis-sportradar", now: NOW }

export const competitions = [
  { id: "sr:competition:2555", name: "Wimbledon Men Singles", parent_id: "sr:competition:2553", type: "singles", gender: "men", level: "grand_slam", category: { id: "sr:category:3", name: "ATP" } },
  { id: "sr:competition:2556", name: "Wimbledon Women Doubles", parent_id: "sr:competition:2553", type: "doubles", gender: "women", level: "grand_slam", category: { id: "sr:category:6", name: "WTA" } },
  { id: "sr:competition:2557", name: "Wimbledon Mixed Doubles", parent_id: "sr:competition:2553", type: "mixed_doubles", gender: "mixed", level: "grand_slam", category: { id: "sr:category:3", name: "ATP" } },
  { id: "sr:competition:9001", name: "ATP Halle, Germany Men Singles", type: "singles", gender: "men", level: "atp_500", category: { id: "sr:category:3", name: "ATP" } },
  { id: "sr:competition:2553", name: "Wimbledon", type: "", gender: "", level: "grand_slam", category: { id: "sr:category:3", name: "ATP" } },
]

export const seasonsByCompetition: Record<string, unknown[]> = {
  "sr:competition:2555": [
    { id: "sr:season:120983", name: "Wimbledon Men Singles 2025", start_date: "2025-06-23", end_date: "2025-07-13", year: "2025", competition_id: "sr:competition:2555" },
    { id: "sr:season:130001", name: "Wimbledon Men Singles 2026", start_date: "2026-06-29", end_date: "2026-07-12", year: "2026", competition_id: "sr:competition:2555" },
  ],
  "sr:competition:2556": [{ id: "sr:season:130002", name: "Wimbledon Women Doubles 2026", start_date: "2026-06-29", end_date: "2026-07-12", year: "2026", competition_id: "sr:competition:2556" }],
  "sr:competition:2557": [{ id: "sr:season:130003", name: "Wimbledon Mixed Doubles 2026", start_date: "2026-06-29", end_date: "2026-07-12", year: "2026", competition_id: "sr:competition:2557", disabled: true }],
}

export const singlesClosed: RawSummary = {
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

export const doublesLive: RawSummary = {
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

export const cancelled: RawSummary = {
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

export const broken: RawSummary = {
  sport_event: {
    id: "sr:sport_event:50004",
    start_time: "2026-07-06T10:00:00+00:00",
    sport_event_context: { competition: { id: "sr:competition:2556" }, season: { id: "sr:season:130002" } },
    competitors: [{ id: "sr:competitor:900009", name: "Unknown pair", qualifier: "home", type: "doubles", players: [] }],
  },
  sport_event_status: { status: "not_started" },
}

export const payload: SportradarTennisPayload = {
  competitions: competitions.filter((c) => c.level === "grand_slam" && ["singles", "doubles", "mixed_doubles"].includes(c.type)),
  seasons: [seasonsByCompetition["sr:competition:2555"][1], seasonsByCompetition["sr:competition:2556"][0]] as SportradarTennisPayload["seasons"],
  summaries: [singlesClosed, doublesLive, cancelled, broken],
}

export function configured(overrides: Partial<SportradarTennisConfig> = {}): () => SportradarTennisConfig {
  return () => ({ apiKey: "test-key", accessLevel: "trial", baseUrl: "https://api.example.test/tennis", language: "en", levels: ["grand_slam"], requestIntervalMs: 0, ...overrides })
}

/** In-memory Sportradar: competitions, per-competition seasons, and paginated summaries with X-Max-Results. */
export function fakeApi(summariesBySeason: Record<string, RawSummary[]>, pageSize = 200) {
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

