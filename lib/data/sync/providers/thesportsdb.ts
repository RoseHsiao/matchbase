import {
  ProviderConfigurationError,
  type NormalizedLeague,
  type NormalizedMatch,
  type NormalizedMatchStatus,
  type NormalizedSeason,
  type NormalizedSnapshot,
  type NormalizedTeam,
  type NormalizedVenue,
  type Provider,
  type SyncContext,
  type SyncIssue,
} from "@/lib/data/sync/types"
import { fetchJson, RateLimiter } from "@/lib/data/sync/utils/http"

/**
 * TheSportsDB V1 adapter (https://www.thesportsdb.com/documentation).
 *
 * One adapter instance serves one league of one sport; the league id, the
 * MatchBase sport and the display names are source configuration (see
 * `TheSportsDbSource`), so another league is a registry entry, not code.
 * The first bound source is English Premier League football.
 *
 * V1 puts the key in the URL path and, on the free tier, caps every listing:
 * teams 10, season schedule 15, day schedule 3, next and previous 1, all at
 * 30 requests per minute. The adapter therefore builds its snapshot from
 * several small documented calls (league, team list, season schedule, next,
 * previous, one day-schedule call per day of a window around the run) and
 * fills clubs the team list did not include with single team lookups, under a
 * per-run request budget and a minimum interval well below the limit. Nothing
 * here pretends the free tier is complete; docs/providers/thesportsdb.md says
 * exactly what arrives.
 *
 * Mapping to MatchBase (all V1 field names stay inside this file):
 * - league             -> League (sport from the source configuration, checked against strSport)
 * - strCurrentSeason   -> Season named by the season string, with a derived calendar window
 * - team               -> Team (idTeam, strTeam, strTeamShort as the code, strBadge, strColour1)
 * - event              -> NormalizedMatch: home team side A, away team side B;
 *                         MatchParticipant rows are written by the generic sync
 * - event idVenue      -> Venue
 * - strStatus          -> upcoming | live | finished | unknown (never guessed)
 * - strTimestamp       -> UTC instant (the feed's timestamps carry no zone; see toInstant)
 *
 * Players are not synced in this phase.
 */

// ---------------------------------------------------------------------------
// Configuration (environment) and source binding (code)
// ---------------------------------------------------------------------------

/** Documented free-tier ceiling. The default interval stays well under it. */
export const FREE_TIER_REQUESTS_PER_MINUTE = 30
export const DEFAULT_BASE_URL = "https://www.thesportsdb.com/api/v1/json"
/** The public free V1 key from the documentation. Configuration, never scattered. */
export const PUBLIC_FREE_API_KEY = "123"

export type TheSportsDbConfig = {
  apiKey: string
  baseUrl: string
  /** Minimum gap between requests. 2500 ms keeps a run at 24 requests/minute. */
  requestIntervalMs: number
  /** Day-schedule window around the run's reference date. */
  pastDays: number
  futureDays: number
  /** Hard cap on requests per run, so a wide window cannot exceed the free tier. */
  maxRequestsPerRun: number
  /** Season string such as "2026-2027"; defaults to the league's current season. */
  season?: string
}

/** What distinguishes one bound source from another: the league and how MatchBase names it. */
export type TheSportsDbSource = {
  /** Registry key, e.g. "thesportsdb-epl". */
  key: string
  /** Display name for Admin. */
  name: string
  /** MatchBase sport the league belongs to; verified against the feed's strSport. */
  sport: string
  /** TheSportsDB idLeague. */
  leagueId: string
  /** MatchBase short name; defaults to the feed's first alternate name, then its full name. */
  shortName?: string
}

function integer(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return value !== undefined && value.trim() !== "" && Number.isInteger(n) ? n : fallback
}

export function readTheSportsDbConfig(env: Record<string, string | undefined> = process.env): TheSportsDbConfig {
  return {
    apiKey: env.THESPORTSDB_API_KEY?.trim() || PUBLIC_FREE_API_KEY,
    baseUrl: (env.THESPORTSDB_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    requestIntervalMs: integer(env.THESPORTSDB_REQUEST_INTERVAL_MS, 2500),
    pastDays: integer(env.THESPORTSDB_PAST_DAYS, 2),
    futureDays: integer(env.THESPORTSDB_FUTURE_DAYS, 7),
    maxRequestsPerRun: integer(env.THESPORTSDB_MAX_REQUESTS, 28),
    season: env.THESPORTSDB_SEASON?.trim() || undefined,
  }
}

/** Every problem in one message; the key's value is never included. */
export function validateTheSportsDbConfig(config: TheSportsDbConfig, source: TheSportsDbSource): { configured: true; detail?: string } | { configured: false; error: string } {
  const problems: string[] = []
  if (!config.apiKey) problems.push("THESPORTSDB_API_KEY is empty")
  if (!/^https?:\/\//.test(config.baseUrl)) problems.push("THESPORTSDB_BASE_URL must be an http(s) URL")
  if (!(config.requestIntervalMs >= 0)) problems.push("THESPORTSDB_REQUEST_INTERVAL_MS must be a non-negative number")
  if (config.pastDays < 0 || config.futureDays < 0) problems.push("THESPORTSDB_PAST_DAYS and THESPORTSDB_FUTURE_DAYS must not be negative")
  if (config.maxRequestsPerRun < 5) problems.push("THESPORTSDB_MAX_REQUESTS must allow at least the five base requests")
  if (!/^\d+$/.test(source.leagueId)) problems.push(`source league id "${source.leagueId}" is not a TheSportsDB id`)
  if (problems.length === 0) {
    const perMinute = config.requestIntervalMs > 0 ? Math.floor(60_000 / config.requestIntervalMs) : Number.POSITIVE_INFINITY
    const keyNote = config.apiKey === PUBLIC_FREE_API_KEY ? "public free V1 key" : "custom V1 key"
    return { configured: true, detail: `${keyNote} · league ${source.leagueId} · at most ${config.maxRequestsPerRun} requests per run, ${Number.isFinite(perMinute) ? perMinute : "unthrottled"}/min · free tier truncates listings` }
  }
  return { configured: false, error: `${problems.join("; ")}. The TheSportsDB provider cannot run.` }
}

// ---------------------------------------------------------------------------
// Raw payload (private to this adapter; the subset of V1 fields it reads)
// ---------------------------------------------------------------------------

type Nullable = string | null | undefined

export type RawLeague = {
  idLeague: string
  strSport?: Nullable
  strLeague?: Nullable
  strLeagueAlternate?: Nullable
  strCurrentSeason?: Nullable
  strCountry?: Nullable
  strBadge?: Nullable
}

export type RawTeam = {
  idTeam: string
  strTeam?: Nullable
  strTeamShort?: Nullable
  strSport?: Nullable
  idLeague?: Nullable
  strColour1?: Nullable
  strBadge?: Nullable
}

export type RawEvent = {
  idEvent: string
  strEvent?: Nullable
  strSport?: Nullable
  idLeague?: Nullable
  strSeason?: Nullable
  idHomeTeam?: Nullable
  idAwayTeam?: Nullable
  strHomeTeam?: Nullable
  strAwayTeam?: Nullable
  strHomeTeamBadge?: Nullable
  strAwayTeamBadge?: Nullable
  intHomeScore?: Nullable
  intAwayScore?: Nullable
  intRound?: Nullable
  /** "YYYY-MM-DDTHH:mm:ss" without a zone designator; observed to be UTC. */
  strTimestamp?: Nullable
  dateEvent?: Nullable
  /** "HH:mm:ss" in UTC, or null on old fixtures. */
  strTime?: Nullable
  idVenue?: Nullable
  strVenue?: Nullable
  strCountry?: Nullable
  strCity?: Nullable
  strStatus?: Nullable
  strPostponed?: Nullable
}

export type TheSportsDbPayload = {
  league: RawLeague
  /** The season string the events were requested for. */
  season: string
  teams: RawTeam[]
  events: RawEvent[]
  /** Warnings raised while fetching (e.g. the request budget cut team lookups short). */
  issues: SyncIssue[]
  requestCount: number
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export type JsonRequest = <T>(url: string, init: { signal?: AbortSignal }) => Promise<T>

function defaultRequest(limiter: RateLimiter): JsonRequest {
  // 429 and 5xx are retried once after a long pause; the free tier is shared, so be gentle.
  return <T>(url: string, init: { signal?: AbortSignal }) =>
    fetchJson<T>(url, { limiter, signal: init.signal, timeoutMs: 15_000, retries: 1, delayMs: 5_000, maxDelayMs: 30_000 })
}

/** Endpoint construction in one place. Values are URL-encoded; the key is a path segment per the V1 documentation. */
export function endpoint(config: Pick<TheSportsDbConfig, "baseUrl" | "apiKey">, path: string, params: Record<string, string>): string {
  const url = new URL(`${config.baseUrl}/${encodeURIComponent(config.apiKey)}/${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

/** The documented list-teams parameter wants the league name with underscores for spaces. */
export function leagueNameParameter(name: string): string {
  return name.trim().replace(/\s+/g, "_")
}

/** Calendar days (UTC) from `pastDays` before to `futureDays` after the reference instant, inclusive. */
export function dayWindow(now: Date, pastDays: number, futureDays: number): string[] {
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const days: string[] = []
  for (let offset = -pastDays; offset <= futureDays; offset++) days.push(new Date(base + offset * 86_400_000).toISOString().slice(0, 10))
  return days
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

/** TheSportsDB sport names -> MatchBase sport codes. Only sports in the catalogue registry. */
export const SPORT_MAP: Record<string, string> = {
  Soccer: "football",
  Basketball: "basketball",
  Tennis: "tennis",
}

/**
 * strStatus -> MatchBase. The observed values are NS and FT; the rest of the
 * vocabulary follows the feed's football status codes (TheSportsDB mirrors
 * API-Football ids and codes). Anything else, including empty, is `unknown`,
 * so the sync keeps the stored status and records a warning; nothing is ever
 * guessed into finished or upcoming.
 */
export const STATUS_MAP: Record<string, NormalizedMatchStatus> = {
  NS: "upcoming",
  "1H": "live",
  HT: "live",
  "2H": "live",
  ET: "live",
  BT: "live",
  P: "live",
  LIVE: "live",
  INT: "live",
  FT: "finished",
  AET: "finished",
  PEN: "finished",
}

/** Human labels for live phases, used as the match's live detail. */
const LIVE_DETAIL: Record<string, string> = { "1H": "1st half", HT: "Half time", "2H": "2nd half", ET: "Extra time", BT: "Break", P: "Penalties", LIVE: "Live", INT: "Interrupted" }

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^\d{2}:\d{2}:\d{2}$/

/**
 * The feed's `strTimestamp` ("2026-09-18T19:00:00") and `dateEvent` +
 * `strTime` carry no zone designator. They are UTC: the same events carry
 * `strTimeLocal` one hour later for English clubs in British Summer Time,
 * and the documentation describes strTime as UTC. An explicit "Z" is
 * appended; a value that already carries a zone is respected. Missing or
 * malformed values yield undefined and fail that record only.
 */
export function toInstant(event: Pick<RawEvent, "strTimestamp" | "dateEvent" | "strTime">): string | undefined {
  const stamp = event.strTimestamp?.trim()
  if (stamp) {
    const iso = TIMESTAMP.test(stamp) ? `${stamp}Z` : stamp
    const ms = Date.parse(iso)
    if (!Number.isNaN(ms) && /([zZ]|[+-]\d{2}:\d{2})$/.test(iso)) return new Date(ms).toISOString()
  }
  const date = event.dateEvent?.trim()
  const time = event.strTime?.trim()
  if (date && time && DATE.test(date) && TIME.test(time)) {
    const ms = Date.parse(`${date}T${time}Z`)
    if (!Number.isNaN(ms)) return new Date(ms).toISOString()
  }
  return undefined
}

function score(value: Nullable): number | undefined {
  if (value === null || value === undefined || value.trim() === "") return undefined
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : undefined
}

/**
 * The free tier exposes no season dates. A split-year name ("2026-2027") is
 * given a July-to-June window and a single year a calendar-year window, so
 * the Season row has real bounds without inventing a start date for a match.
 */
export function seasonWindow(name: string): { startsAt: string; endsAt: string } | undefined {
  const split = /^(\d{4})-(\d{4})$/.exec(name)
  if (split) return { startsAt: `${split[1]}-07-01`, endsAt: `${split[2]}-06-30` }
  const single = /^(\d{4})$/.exec(name)
  if (single) return { startsAt: `${single[1]}-01-01`, endsAt: `${single[1]}-12-31` }
  return undefined
}

function text(value: Nullable): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/** "ARS"; falls back to the first letters of the name and keeps codes unique within the snapshot. */
function teamCode(team: RawTeam, taken: Set<string>): string {
  const short = text(team.strTeamShort)?.toUpperCase()
  const base = short && /^[A-Z0-9]{2,4}$/.test(short) ? short : (text(team.strTeam) ?? team.idTeam).replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase().padEnd(3, "X")
  let code = base
  for (let n = 2; taken.has(code); n++) code = `${base.slice(0, 3)}${n}`.slice(0, 4)
  taken.add(code)
  return code
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export type TheSportsDbOptions = {
  config?: () => TheSportsDbConfig
  request?: JsonRequest
}

export function createTheSportsDbProvider(source: TheSportsDbSource, options: TheSportsDbOptions = {}): Provider<TheSportsDbPayload> {
  const readConfig = options.config ?? (() => readTheSportsDbConfig())
  let limiter: RateLimiter | undefined

  return {
    key: source.key,
    name: source.name,
    sport: source.sport,
    kind: "live",

    checkConfiguration() {
      return validateTheSportsDbConfig(readConfig(), source)
    },

    async fetch(context: SyncContext): Promise<TheSportsDbPayload> {
      const config = readConfig()
      const readiness = validateTheSportsDbConfig(config, source)
      if (!readiness.configured) throw new ProviderConfigurationError(readiness.error)
      limiter ??= new RateLimiter(config.requestIntervalMs)
      const request = options.request ?? defaultRequest(limiter)
      const issues: SyncIssue[] = []
      let requestCount = 0

      const get = async <T>(path: string, params: Record<string, string>): Promise<T> => {
        if (requestCount >= config.maxRequestsPerRun) throw new Error(`Request budget of ${config.maxRequestsPerRun} per run exhausted before ${path}.`)
        requestCount++
        const url = endpoint(config, path, params)
        try {
          return await request<T>(url, { signal: context.signal })
        } catch (error) {
          // Defence in depth: the key is a path segment, so scrub it from whatever the transport reports.
          if (error instanceof Error && config.apiKey !== PUBLIC_FREE_API_KEY) error.message = error.message.split(encodeURIComponent(config.apiKey)).join("REDACTED")
          throw error
        }
      }
      const events = (body: { events?: RawEvent[] | null } | null | undefined): RawEvent[] => (Array.isArray(body?.events) ? body.events : [])

      const leagueBody = await get<{ leagues?: RawLeague[] | null }>("lookupleague.php", { id: source.leagueId })
      const league = Array.isArray(leagueBody?.leagues) ? leagueBody.leagues[0] : undefined
      if (!league || typeof league.idLeague !== "string") throw new Error(`League ${source.leagueId} is not in the feed (lookupleague returned no league).`)

      const season = config.season ?? text(league.strCurrentSeason)
      if (!season) throw new Error(`League ${source.leagueId} reports no current season and THESPORTSDB_SEASON is not set.`)

      const leagueName = text(league.strLeague)
      const teamBody = leagueName ? await get<{ teams?: RawTeam[] | null }>("search_all_teams.php", { l: leagueNameParameter(leagueName) }) : undefined
      const teams: RawTeam[] = Array.isArray(teamBody?.teams) ? teamBody.teams.filter((t) => t && typeof t.idTeam === "string") : []

      const collected: RawEvent[] = []
      collected.push(...events(await get("eventsseason.php", { id: source.leagueId, s: season })))
      collected.push(...events(await get("eventsnextleague.php", { id: source.leagueId })))
      collected.push(...events(await get("eventspastleague.php", { id: source.leagueId })))
      for (const day of dayWindow(context.now, config.pastDays, config.futureDays)) {
        if (requestCount >= config.maxRequestsPerRun) {
          issues.push({ level: "warning", entity: "provider", message: `Request budget reached; day schedule stopped before ${day}.` })
          break
        }
        collected.push(...events(await get("eventsday.php", { d: day, l: source.leagueId })))
      }

      // Later sources are fresher (next/previous/day are updated before the season list), so the last copy wins.
      const byId = new Map<string, RawEvent>()
      for (const event of collected) if (event && typeof event.idEvent === "string") byId.set(event.idEvent, event)
      const unique = [...byId.values()]

      // The free team list is capped, so clubs that only appear in events are looked up one by one.
      const known = new Set(teams.map((t) => t.idTeam))
      const missing = [...new Set(unique.flatMap((e) => [text(e.idHomeTeam), text(e.idAwayTeam)]).filter((id): id is string => !!id && !known.has(id)))]
      for (const id of missing) {
        if (requestCount >= config.maxRequestsPerRun) {
          issues.push({ level: "warning", entity: "team", externalId: id, message: "Request budget reached; team details taken from the event instead of a lookup." })
          continue
        }
        const body = await get<{ teams?: RawTeam[] | null }>("lookupteam.php", { id })
        const team = Array.isArray(body?.teams) ? body.teams[0] : undefined
        if (team && typeof team.idTeam === "string") teams.push(team)
        else issues.push({ level: "warning", entity: "team", externalId: id, message: "Team lookup returned nothing; team details taken from the event instead." })
      }

      return { league, season, teams, events: unique, issues, requestCount }
    },

    normalize(raw: TheSportsDbPayload, context: SyncContext): NormalizedSnapshot {
      const issues: SyncIssue[] = [...(raw.issues ?? [])]
      const league = raw.league
      const feedSport = text(league.strSport)
      const mapped = feedSport ? SPORT_MAP[feedSport] : undefined
      if (mapped !== source.sport) {
        throw new ProviderConfigurationError(`League ${league.idLeague} is "${feedSport ?? "unknown sport"}" in the feed, which is not MatchBase sport "${source.sport}".`)
      }
      const leagueName = text(league.strLeague) ?? `League ${league.idLeague}`
      const alternate = text(league.strLeagueAlternate)?.split(",").map((s) => s.trim()).find(Boolean)
      const leagues: NormalizedLeague[] = [{ externalId: league.idLeague, sport: source.sport, name: leagueName, shortName: source.shortName ?? alternate ?? leagueName, region: text(league.strCountry) }]

      const window = seasonWindow(raw.season)
      if (!window) throw new Error(`Season "${raw.season}" is not a year or a split-year name.`)
      const current = text(league.strCurrentSeason) === raw.season
      const seasons: NormalizedSeason[] = [{
        externalId: raw.season,
        leagueExternalId: league.idLeague,
        name: raw.season,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        status: current ? "current" : Date.parse(`${window.endsAt}T23:59:59Z`) < context.now.getTime() ? "completed" : "upcoming",
      }]

      // Teams: the list and lookups first, then any club only known from an event.
      const taken = new Set<string>()
      const teamsById = new Map<string, NormalizedTeam>()
      for (const team of raw.teams) {
        if (teamsById.has(team.idTeam)) continue
        const name = text(team.strTeam)
        if (!name) {
          issues.push({ level: "error", entity: "team", externalId: team.idTeam, message: "Team has no name." })
          continue
        }
        teamsById.set(team.idTeam, { externalId: team.idTeam, leagueExternalId: league.idLeague, name, shortName: name, code: teamCode(team, taken), color: text(team.strColour1), logoUrl: text(team.strBadge) })
      }
      for (const event of raw.events) {
        for (const [id, name, badge] of [[text(event.idHomeTeam), text(event.strHomeTeam), text(event.strHomeTeamBadge)], [text(event.idAwayTeam), text(event.strAwayTeam), text(event.strAwayTeamBadge)]] as const) {
          if (!id || teamsById.has(id)) continue
          if (!name) continue
          teamsById.set(id, { externalId: id, leagueExternalId: league.idLeague, name, shortName: name, code: teamCode({ idTeam: id, strTeam: name }, taken), logoUrl: badge })
          issues.push({ level: "warning", entity: "team", externalId: id, message: `Team "${name}" was not in the team list; created from event data with a derived code.` })
        }
      }

      const venues = new Map<string, NormalizedVenue>()
      const matches: NormalizedMatch[] = []
      for (const event of raw.events) {
        const id = event.idEvent
        const problem = (message: string) => issues.push({ level: "error", entity: "match", externalId: id, message })
        if (text(event.idLeague) && event.idLeague !== league.idLeague) {
          issues.push({ level: "warning", entity: "match", externalId: id, message: `Event belongs to league ${event.idLeague}, not ${league.idLeague}; skipped.` })
          continue
        }
        const home = text(event.idHomeTeam)
        const away = text(event.idAwayTeam)
        if (!home || !away) {
          problem("Event has no home or away team id.")
          continue
        }
        if (home === away) {
          problem("Event lists the same team on both sides.")
          continue
        }
        if (!teamsById.has(home) || !teamsById.has(away)) {
          problem(`Event references team ${teamsById.has(home) ? away : home}, which has no name in the feed.`)
          continue
        }
        const startsAt = toInstant(event)
        if (!startsAt) {
          problem(`Event has no usable start time (strTimestamp "${event.strTimestamp ?? ""}", dateEvent "${event.dateEvent ?? ""}", strTime "${event.strTime ?? ""}").`)
          continue
        }
        const eventSeason = text(event.strSeason) ?? raw.season
        if (eventSeason !== raw.season) {
          issues.push({ level: "warning", entity: "match", externalId: id, message: `Event is in season "${eventSeason}", not the synced season "${raw.season}"; skipped.` })
          continue
        }
        const rawStatus = text(event.strStatus) ?? ""
        const postponed = text(event.strPostponed)?.toLowerCase() === "yes"
        const status: NormalizedMatchStatus = postponed ? "unknown" : (STATUS_MAP[rawStatus] ?? "unknown")
        if (status === "unknown") {
          issues.push({ level: "warning", entity: "match", externalId: id, message: postponed ? `Event is marked postponed (status "${rawStatus}"); existing status kept or defaulted to upcoming.` : `Unmapped provider status "${rawStatus}"; existing status kept or defaulted to upcoming.` })
        }
        const homeScore = score(event.intHomeScore)
        const awayScore = score(event.intAwayScore)
        const venueId = text(event.idVenue)
        if (venueId && !venues.has(venueId)) {
          const name = text(event.strVenue)
          if (name) venues.set(venueId, { externalId: venueId, name, city: text(event.strCity), country: text(event.strCountry) })
        }
        const round = text(event.intRound)
        matches.push({
          externalId: id,
          leagueExternalId: league.idLeague,
          seasonExternalId: raw.season,
          homeTeamExternalId: home,
          awayTeamExternalId: away,
          venueExternalId: venueId && venues.has(venueId) ? venueId : undefined,
          startsAt,
          status,
          rawStatus,
          stage: round ? `Matchweek ${round}` : undefined,
          homeScore,
          awayScore,
          liveDetail: status === "live" ? LIVE_DETAIL[rawStatus] : undefined,
        })
      }

      matches.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.externalId.localeCompare(b.externalId))
      return { leagues, seasons, teams: [...teamsById.values()], players: [], venues: [...venues.values()], matches, issues }
    },
  }
}

/** The first bound source: English Premier League football (documented league id 4328). */
export const theSportsDbPremierLeagueProvider = createTheSportsDbProvider({
  key: "thesportsdb-epl",
  name: "TheSportsDB · Premier League",
  sport: "football",
  leagueId: "4328",
})
