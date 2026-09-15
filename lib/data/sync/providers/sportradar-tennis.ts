import {
  ProviderConfigurationError,
  type NormalizedIndividualMatch,
  type NormalizedLeague,
  type NormalizedMatchStatus,
  type NormalizedPlayer,
  type NormalizedSeason,
  type NormalizedSide,
  type NormalizedSnapshot,
  type NormalizedVenue,
  type Provider,
  type SyncContext,
  type SyncIssue,
} from "@/lib/data/sync/types"
import { HttpError, RateLimiter, fetchJson } from "@/lib/data/sync/utils/http"

/**
 * Sportradar Tennis API v3 adapter (https://developer.sportradar.com/tennis).
 *
 * Reads competitions, picks the ones matching the configured levels (Grand
 * Slams by default) and event types (singles, doubles, mixed doubles), then
 * pulls every sport event of the target year's season for each. Credentials
 * and options come from environment variables only; see docs/tennis-provider.md.
 *
 * Mapping to MatchBase:
 * - competition (e.g. "Wimbledon Men Singles") -> League, sport "tennis"
 * - season (e.g. "Wimbledon Men Singles 2025") -> Season named by its year
 * - competitor / doubles competitor.players[] -> Player (no team)
 * - sport_event.venue -> Venue
 * - sport_event -> NormalizedIndividualMatch with two sides (home, away)
 *   holding one player (singles) or two players (doubles) each. These are
 *   not storable in the current Match row; the sync service reports them.
 *
 * Requests: x-api-key header, JSON, paginated with start/limit and the
 * X-Max-Results header, rate-limited to one request per configured interval,
 * retried on 429/5xx by the shared utility. HTTP 401/403 is a configuration
 * error, not a retry.
 */

// ---------------------------------------------------------------------------
// Configuration (environment)
// ---------------------------------------------------------------------------

export type SportradarTennisConfig = {
  apiKey: string | undefined
  /** "trial" or "production"; must match the key. */
  accessLevel: string
  baseUrl: string
  language: string
  /** Season year to sync; defaults to the run's reference year. */
  year?: number
  /** Competition levels to include, e.g. ["grand_slam"]. */
  levels: string[]
  /** Explicit competition ids; when set, `levels` is ignored. */
  competitionIds?: string[]
  /** Minimum gap between requests. Trial keys allow about one request per second. */
  requestIntervalMs: number
}

const EVENT_TYPES = new Set(["singles", "doubles", "mixed_doubles"])

function list(value: string | undefined): string[] | undefined {
  const items = (value ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  return items.length > 0 ? items : undefined
}

export function readSportradarTennisConfig(env: Record<string, string | undefined> = process.env): SportradarTennisConfig {
  const year = env.SPORTRADAR_TENNIS_SEASON_YEAR ? Number(env.SPORTRADAR_TENNIS_SEASON_YEAR) : undefined
  return {
    apiKey: env.SPORTRADAR_API_KEY?.trim() || undefined,
    accessLevel: env.SPORTRADAR_TENNIS_ACCESS_LEVEL?.trim() || "trial",
    baseUrl: (env.SPORTRADAR_TENNIS_BASE_URL?.trim() || "https://api.sportradar.com/tennis").replace(/\/+$/, ""),
    language: env.SPORTRADAR_TENNIS_LANGUAGE?.trim() || "en",
    year: year !== undefined && Number.isInteger(year) ? year : undefined,
    levels: list(env.SPORTRADAR_TENNIS_LEVELS) ?? ["grand_slam"],
    competitionIds: list(env.SPORTRADAR_TENNIS_COMPETITIONS),
    requestIntervalMs: Number(env.SPORTRADAR_TENNIS_REQUEST_INTERVAL_MS) || 1100,
  }
}

// ---------------------------------------------------------------------------
// Raw payload (private to this adapter; subset of the documented schema)
// ---------------------------------------------------------------------------

export type RawCompetition = {
  id: string
  name: string
  parent_id?: string
  type?: string
  gender?: string
  level?: string
  category?: { id?: string; name?: string; country_code?: string }
}

export type RawSeason = {
  id: string
  name: string
  start_date: string
  end_date: string
  year: string
  competition_id?: string
  disabled?: boolean
}

export type RawPlayer = { id: string; name: string }

export type RawCompetitor = {
  id: string
  name: string
  country?: string
  country_code?: string
  abbreviation?: string
  qualifier?: string
  type?: string
  players?: RawPlayer[]
  seed?: number
}

export type RawSummary = {
  sport_event: {
    id: string
    start_time: string
    start_time_confirmed?: boolean
    sport_event_context?: {
      competition?: { id: string; name?: string; type?: string; gender?: string; level?: string }
      season?: { id: string; name?: string; start_date?: string; end_date?: string; year?: string }
      round?: { name?: string; number?: number }
      mode?: { best_of?: number }
    }
    competitors?: RawCompetitor[]
    venue?: { id: string; name: string; city_name?: string; country_name?: string; capacity?: number }
  }
  sport_event_status?: {
    status?: string
    match_status?: string
    home_score?: number
    away_score?: number
    winner_id?: string
  }
}

export type SportradarTennisPayload = {
  competitions: RawCompetition[]
  seasons: RawSeason[]
  summaries: RawSummary[]
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export type JsonRequest = <T>(url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ body: T; headers: Headers }>

function defaultRequest(limiter: RateLimiter): JsonRequest {
  return async <T>(url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => {
    let headers = new Headers()
    const body = await fetchJson<T>(url, { headers: init.headers, limiter, signal: init.signal, timeoutMs: 15_000, retries: 3, onResponse: (h) => { headers = h } })
    return { body, headers }
  }
}

const PAGE_LIMIT = 200

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

/** Provider status -> MatchBase. Anything else is `unknown` and reported. */
const STATUS_MAP: Record<string, NormalizedMatchStatus> = {
  not_started: "upcoming",
  match_about_to_start: "upcoming",
  delayed: "upcoming",
  started: "live",
  live: "live",
  interrupted: "live",
  ended: "finished",
  closed: "finished",
  // cancelled, abandoned, suspended, postponed: deliberately unmapped (never "finished").
}

const TYPE_CODE: Record<string, string> = { singles: "S", doubles: "D", mixed_doubles: "XD" }
const GENDER_CODE: Record<string, string> = { men: "M", male: "M", women: "W", female: "W", mixed: "" }

/** "Wimbledon Men Singles" -> "Wimbledon MS". Deterministic and unique per competition type within a tournament. */
export function leagueShortName(competition: RawCompetition): string {
  const tournament = competition.name.replace(/\s+(Men|Women|Mixed)\s+(Singles|Doubles)\s*$/i, "").trim()
  const code = `${GENDER_CODE[competition.gender ?? ""] ?? ""}${TYPE_CODE[competition.type ?? ""] ?? ""}`
  return (code ? `${tournament} ${code}` : tournament).slice(0, 40)
}

/** Sportradar lists people as "Last, First"; MatchBase displays "First Last". */
export function displayName(name: string): string {
  const parts = name.split(",").map((s) => s.trim())
  return parts.length === 2 && parts[1] ? `${parts[1]} ${parts[0]}` : name.trim()
}

function stageLabel(round?: { name?: string; number?: number }): string | undefined {
  if (!round?.name) return undefined
  const text = round.name.replace(/_/g, " ")
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function liveDetail(matchStatus?: string): string | undefined {
  const set = matchStatus?.match(/^(\d)(?:st|nd|rd|th)_set$/)
  return set ? `Set ${set[1]}` : undefined
}

function seasonStatus(startsAt: string, endsAt: string, now: Date): NormalizedSeason["status"] {
  const start = new Date(`${startsAt}T00:00:00.000Z`).getTime()
  const end = new Date(`${endsAt}T23:59:59.999Z`).getTime()
  if (now.getTime() < start) return "upcoming"
  if (now.getTime() > end) return "completed"
  return "current"
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

export type SportradarTennisOptions = {
  config?: () => SportradarTennisConfig
  request?: JsonRequest
}

export function createSportradarTennisProvider(options: SportradarTennisOptions = {}): Provider<SportradarTennisPayload> {
  const readConfig = options.config ?? (() => readSportradarTennisConfig())
  let limiter: RateLimiter | undefined

  return {
    key: "sportradar-tennis",
    name: "Sportradar Tennis",
    sport: "tennis",

    async fetch(context: SyncContext): Promise<SportradarTennisPayload> {
      const config = readConfig()
      if (!config.apiKey) {
        throw new ProviderConfigurationError("SPORTRADAR_API_KEY is not set; the Sportradar tennis provider cannot authenticate.")
      }
      limiter ??= new RateLimiter(config.requestIntervalMs)
      const request = options.request ?? defaultRequest(limiter)
      const headers = { accept: "application/json", "x-api-key": config.apiKey }
      const root = `${config.baseUrl}/${config.accessLevel}/v3/${config.language}`
      const get = async <T>(path: string): Promise<{ body: T; headers: Headers }> => {
        try {
          return await request<T>(`${root}/${path}`, { headers, signal: context.signal })
        } catch (error) {
          if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
            throw new ProviderConfigurationError(`Sportradar rejected the API key (HTTP ${error.status}). Check SPORTRADAR_API_KEY and SPORTRADAR_TENNIS_ACCESS_LEVEL.`)
          }
          throw error
        }
      }

      const { body: competitionsBody } = await get<{ competitions?: RawCompetition[] }>("competitions.json")
      const all = competitionsBody.competitions ?? []
      const competitions = all.filter((c) => {
        if (config.competitionIds) return config.competitionIds.includes(c.id)
        return config.levels.includes(c.level ?? "") && EVENT_TYPES.has(c.type ?? "")
      })

      const year = String(config.year ?? context.now.getUTCFullYear())
      const seasons: RawSeason[] = []
      const summaries: RawSummary[] = []
      for (const competition of competitions) {
        const { body } = await get<{ seasons?: RawSeason[] }>(`competitions/${competition.id}/seasons.json`)
        for (const season of body.seasons ?? []) {
          if (season.disabled || String(season.year) !== year) continue
          seasons.push({ ...season, competition_id: season.competition_id ?? competition.id })
          let start = 0
          for (;;) {
            const page = await get<{ summaries?: RawSummary[] }>(`seasons/${season.id}/summaries.json?start=${start}&limit=${PAGE_LIMIT}`)
            const items = page.body.summaries ?? []
            summaries.push(...items)
            // The documented total lives in X-Max-Results; a page may be shorter than
            // the requested limit, so only fall back to page size when the header is absent.
            const max = Number(page.headers.get("x-max-results") ?? "")
            start += items.length
            if (items.length === 0) break
            if (Number.isFinite(max) && max > 0) {
              if (start >= max) break
            } else if (items.length < PAGE_LIMIT) break
          }
        }
      }
      return { competitions, seasons, summaries }
    },

    normalize(raw: SportradarTennisPayload, context: SyncContext): NormalizedSnapshot {
      const issues: SyncIssue[] = []
      const leagues: NormalizedLeague[] = raw.competitions.map((c) => ({
        externalId: c.id,
        sport: "tennis",
        name: c.name,
        shortName: leagueShortName(c),
        region: c.category?.name,
      }))
      const seasons: NormalizedSeason[] = raw.seasons.map((s) => ({
        externalId: s.id,
        leagueExternalId: s.competition_id as string,
        name: String(s.year),
        startsAt: s.start_date,
        endsAt: s.end_date,
        status: seasonStatus(s.start_date, s.end_date, context.now),
      }))

      const players = new Map<string, NormalizedPlayer>()
      const venues = new Map<string, NormalizedVenue>()
      const individualMatches: NormalizedIndividualMatch[] = []

      for (const summary of raw.summaries) {
        const event = summary.sport_event
        const competitionId = event.sport_event_context?.competition?.id
        const seasonId = event.sport_event_context?.season?.id
        if (!competitionId || !seasonId) {
          issues.push({ level: "error", entity: "match", externalId: event.id, message: "Event has no competition or season context." })
          continue
        }
        if (event.venue) {
          venues.set(event.venue.id, { externalId: event.venue.id, name: event.venue.name, city: event.venue.city_name, country: event.venue.country_name, capacity: event.venue.capacity })
        }

        const sides: NormalizedSide[] = []
        let unsupported: string | undefined
        const competitors = [...(event.competitors ?? [])].sort((a, b) => (a.qualifier === "home" ? -1 : b.qualifier === "home" ? 1 : 0))
        for (const competitor of competitors) {
          const isDoubles = (competitor.type ?? "singles") !== "singles" || (competitor.players?.length ?? 0) > 1
          const members: RawPlayer[] = isDoubles ? (competitor.players ?? []) : [{ id: competitor.id, name: competitor.name }]
          if (members.length === 0 || members.some((m) => !m.id)) {
            unsupported = `Competitor ${competitor.id} has no identifiable players.`
            break
          }
          for (const member of members) {
            if (!players.has(member.id)) {
              players.set(member.id, {
                externalId: member.id,
                name: displayName(member.name),
                nationality: isDoubles ? undefined : competitor.country,
              })
            }
          }
          const score = competitor.qualifier === "home" ? summary.sport_event_status?.home_score : summary.sport_event_status?.away_score
          sides.push({ participants: members.map((m) => ({ kind: "player", externalId: m.id })), score: typeof score === "number" ? score : undefined })
        }
        if (unsupported || sides.length !== 2) {
          issues.push({ level: "error", entity: "match", externalId: event.id, message: unsupported ?? `Expected two sides, got ${sides.length}.` })
          continue
        }
        // Scores are an aggregate pair (sets won); drop a lone score rather than store half a result.
        if ((sides[0].score === undefined) !== (sides[1].score === undefined)) {
          sides[0].score = undefined
          sides[1].score = undefined
          issues.push({ level: "warning", entity: "match", externalId: event.id, message: "Only one side had a score; both were dropped." })
        }

        const rawStatus = summary.sport_event_status?.status ?? ""
        const status = STATUS_MAP[rawStatus] ?? "unknown"
        if (status === "unknown") {
          issues.push({ level: "warning", entity: "match", externalId: event.id, message: `Unmapped provider status "${rawStatus || "(empty)"}"; existing status kept or defaulted to upcoming.` })
        }
        individualMatches.push({
          externalId: event.id,
          leagueExternalId: competitionId,
          seasonExternalId: seasonId,
          venueExternalId: event.venue?.id,
          startsAt: event.start_time,
          status,
          rawStatus,
          stage: stageLabel(event.sport_event_context?.round),
          sides: [sides[0], sides[1]],
          liveDetail: status === "live" ? liveDetail(summary.sport_event_status?.match_status) : undefined,
        })
      }

      return {
        leagues,
        seasons,
        teams: [],
        players: [...players.values()],
        venues: [...venues.values()],
        matches: [],
        individualMatches,
        issues,
      }
    },
  }
}

/** The registered instance, configured from the environment. */
export const sportradarTennisProvider = createSportradarTennisProvider()
