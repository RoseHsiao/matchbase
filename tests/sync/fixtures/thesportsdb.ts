/**
 * Sanitized fixtures captured from the TheSportsDB V1 free API on 2026-09-17
 * (league 4328, English Premier League), reduced to the fields the adapter
 * reads plus a few it ignores, so parsing stays realistic. Ids and names are
 * real; artwork URLs are shortened. Test-only: production code never imports
 * this module and no test contacts the API.
 */
import type { JsonRequest, RawEvent, RawLeague, RawTeam, TheSportsDbConfig, TheSportsDbSource } from "../../../lib/data/sync/providers/thesportsdb"
import type { SyncContext } from "../../../lib/data/sync/types"
import { HttpError, MalformedResponseError } from "../../../lib/data/sync/utils/http"

export const NOW = new Date("2026-09-17T12:00:00Z")
export const SOURCE_ID = "ds-thesportsdb-epl"
export const context: SyncContext = { dataSourceId: SOURCE_ID, now: NOW }

export const source: TheSportsDbSource = { key: "thesportsdb-epl", name: "TheSportsDB · Premier League", sport: "football", leagueId: "4328" }

export function configured(overrides: Partial<TheSportsDbConfig> = {}): () => TheSportsDbConfig {
  return () => ({ apiKey: "123", baseUrl: "https://api.example.test/v1/json", requestIntervalMs: 0, pastDays: 1, futureDays: 1, maxRequestsPerRun: 28, ...overrides })
}

// lookupleague.php?id=4328 → { leagues: [ … ] }  (47 fields upstream; unread ones trimmed)
export const league: RawLeague & Record<string, unknown> = {
  idLeague: "4328",
  idAPIfootball: "8346",
  strSport: "Soccer",
  strLeague: "English Premier League",
  strLeagueAlternate: "Premier League, EPL, England",
  idCup: "0",
  strCurrentSeason: "2026-2027",
  intFormedYear: "1992",
  strGender: "Male",
  strCountry: "England",
  strBadge: "https://r2.thesportsdb.com/images/media/league/badge/gasy9d1.png",
  strNaming: "{strHomeTeam} vs {strAwayTeam}",
}

// search_all_teams.php?l=English_Premier_League → { teams: [ 10 of 20 clubs on the free tier ] }; three kept
export const teamList: (RawTeam & Record<string, unknown>)[] = [
  { idTeam: "133604", strTeam: "Arsenal", strTeamShort: "ARS", strSport: "Soccer", idLeague: "4328", strLeague: "English Premier League", idVenue: "15528", strStadium: "Emirates Stadium", strColour1: "#EF0107", strColour2: "#FFFFFF", strBadge: "https://r2.thesportsdb.com/images/media/team/badge/arsenal.png", strCountry: "England" },
  { idTeam: "133610", strTeam: "Chelsea", strTeamShort: "CHE", strSport: "Soccer", idLeague: "4328", strLeague: "English Premier League", idVenue: "15533", strStadium: "Stamford Bridge", strColour1: "#034694", strColour2: "#FFFFFF", strBadge: "https://r2.thesportsdb.com/images/media/team/badge/chelsea.png", strCountry: "England" },
  { idTeam: "134355", strTeam: "Brentford", strTeamShort: "BRE", strSport: "Soccer", idLeague: "4328", strLeague: "English Premier League", idVenue: "18406", strStadium: "Brentford Community Stadium", strColour1: "", strColour2: "", strBadge: "https://r2.thesportsdb.com/images/media/team/badge/brentford.png", strCountry: "England" },
]

// lookupteam.php?id=… → { teams: [ one ] }
export const teamLookups: Record<string, RawTeam & Record<string, unknown>> = {
  "133635": { idTeam: "133635", strTeam: "Leeds United", strTeamShort: "LEE", strSport: "Soccer", idLeague: "4328", strColour1: "#FFFFFF", strBadge: "https://r2.thesportsdb.com/images/media/team/badge/leeds.png" },
  "134777": { idTeam: "134777", strTeam: "Newcastle United", strTeamShort: "NEW", strSport: "Soccer", idLeague: "4328", strColour1: "#241F20", strBadge: "https://r2.thesportsdb.com/images/media/team/badge/newcastle.png" },
  "133612": { idTeam: "133612", strTeam: "Manchester United", strTeamShort: "MUN", strSport: "Soccer", idLeague: "4328", strColour1: "#DA291C", strBadge: "https://r2.thesportsdb.com/images/media/team/badge/manutd.png" },
  "133613": { idTeam: "133613", strTeam: "Manchester City", strTeamShort: "MCI", strSport: "Soccer", idLeague: "4328", strColour1: "#6CABDD", strBadge: "https://r2.thesportsdb.com/images/media/team/badge/mancity.png" },
}

const eventDefaults = { strSport: "Soccer", idLeague: "4328", strLeague: "English Premier League", strSeason: "2026-2027", strCountry: "England", strCity: "", strPostponed: "no", strLocked: "unlocked", intHomeScoreExtra: null, intAwayScoreExtra: null, strDescriptionEN: "" }

// eventsseason.php?id=4328&s=2026-2027 → first 15 events of the season on the free tier; two kept
export const seasonEvents: (RawEvent & Record<string, unknown>)[] = [
  { ...eventDefaults, idEvent: "2494001", strEvent: "Arsenal vs Chelsea", strTimestamp: "2026-08-22T16:30:00", dateEvent: "2026-08-22", dateEventLocal: "2026-08-22", strTime: "16:30:00", strTimeLocal: "17:30:00", intRound: "1", idHomeTeam: "133604", idAwayTeam: "133610", strHomeTeam: "Arsenal", strAwayTeam: "Chelsea", strHomeTeamBadge: "https://r2.thesportsdb.com/images/media/team/badge/arsenal.png", strAwayTeamBadge: "https://r2.thesportsdb.com/images/media/team/badge/chelsea.png", intHomeScore: "2", intAwayScore: "2", idVenue: "15528", strVenue: "Emirates Stadium", strStatus: "FT" },
  { ...eventDefaults, idEvent: "2494002", strEvent: "Brentford vs Arsenal", strTimestamp: "2026-08-29T14:00:00", dateEvent: "2026-08-29", dateEventLocal: "2026-08-29", strTime: "14:00:00", strTimeLocal: "15:00:00", intRound: "2", idHomeTeam: "134355", idAwayTeam: "133604", strHomeTeam: "Brentford", strAwayTeam: "Arsenal", strHomeTeamBadge: "https://r2.thesportsdb.com/images/media/team/badge/brentford.png", strAwayTeamBadge: "https://r2.thesportsdb.com/images/media/team/badge/arsenal.png", intHomeScore: "0", intAwayScore: "3", idVenue: "18406", strVenue: "Brentford Community Stadium", strStatus: "FT" },
]

// eventsnextleague.php?id=4328 → exactly one event on the free tier
export const nextEvent: RawEvent & Record<string, unknown> = { ...eventDefaults, idEvent: "2494047", strEvent: "Brentford vs Chelsea", strTimestamp: "2026-09-18T19:00:00", dateEvent: "2026-09-18", dateEventLocal: "2026-09-18", strTime: "19:00:00", strTimeLocal: "20:00:00", intRound: "5", idHomeTeam: "134355", idAwayTeam: "133610", strHomeTeam: "Brentford", strAwayTeam: "Chelsea", strHomeTeamBadge: "https://r2.thesportsdb.com/images/media/team/badge/brentford.png", strAwayTeamBadge: "https://r2.thesportsdb.com/images/media/team/badge/chelsea.png", intHomeScore: null, intAwayScore: null, idVenue: "18406", strVenue: "Brentford Community Stadium", strStatus: "NS" }

// eventspastleague.php?id=4328 → exactly one event on the free tier
export const pastEvent: RawEvent & Record<string, unknown> = { ...eventDefaults, idEvent: "2494036", strEvent: "Leeds United vs Newcastle United", strTimestamp: "2026-09-14T19:00:00", dateEvent: "2026-09-14", dateEventLocal: "2026-09-14", strTime: "19:00:00", strTimeLocal: "20:00:00", intRound: "4", idHomeTeam: "133635", idAwayTeam: "134777", strHomeTeam: "Leeds United", strAwayTeam: "Newcastle United", strHomeTeamBadge: "https://r2.thesportsdb.com/images/media/team/badge/leeds.png", strAwayTeamBadge: "https://r2.thesportsdb.com/images/media/team/badge/newcastle.png", intHomeScore: "4", intAwayScore: "1", idVenue: "15534", strVenue: "Elland Road", strStatus: "FT" }

// eventsday.php?d=…&l=4328 → up to three events per day on the free tier
export const dayEvents: Record<string, (RawEvent & Record<string, unknown>)[]> = {
  "2026-09-16": [
    { ...eventDefaults, idEvent: "2494030", strEvent: "Manchester United vs Manchester City", strTimestamp: "2026-09-16T15:30:00", dateEvent: "2026-09-16", strTime: "15:30:00", strTimeLocal: "16:30:00", intRound: "4", idHomeTeam: "133612", idAwayTeam: "133613", strHomeTeam: "Manchester United", strAwayTeam: "Manchester City", intHomeScore: "0", intAwayScore: "1", idVenue: "18332", strVenue: "Old Trafford", strStatus: "FT" },
  ],
  "2026-09-17": [
    // In play at the reference instant; scores present, half-time status.
    { ...eventDefaults, idEvent: "2494049", strEvent: "Chelsea vs Leeds United", strTimestamp: "2026-09-17T11:00:00", dateEvent: "2026-09-17", strTime: "11:00:00", strTimeLocal: "12:00:00", intRound: "5", idHomeTeam: "133610", idAwayTeam: "133635", strHomeTeam: "Chelsea", strAwayTeam: "Leeds United", intHomeScore: "1", intAwayScore: "0", idVenue: "15533", strVenue: "Stamford Bridge", strStatus: "HT" },
  ],
  "2026-09-18": [
    // The same event as eventsnextleague, as the day endpoint returns it (deduplicated by idEvent).
    { ...eventDefaults, idEvent: "2494047", strEvent: "Brentford vs Chelsea", strTimestamp: "2026-09-18T19:00:00", dateEvent: "2026-09-18", strTime: "19:00:00", strTimeLocal: "20:00:00", intRound: "5", idHomeTeam: "134355", idAwayTeam: "133610", strHomeTeam: "Brentford", strAwayTeam: "Chelsea", intHomeScore: null, intAwayScore: null, idVenue: "18406", strVenue: "Brentford Community Stadium", strStatus: "NS" },
    { ...eventDefaults, idEvent: "2494050", strEvent: "Newcastle United vs Arsenal", strTimestamp: "2026-09-18T16:30:00", dateEvent: "2026-09-18", strTime: "16:30:00", strTimeLocal: "17:30:00", intRound: "5", idHomeTeam: "134777", idAwayTeam: "133604", strHomeTeam: "Newcastle United", strAwayTeam: "Arsenal", intHomeScore: null, intAwayScore: null, idVenue: "16294", strVenue: "St James' Park", strStatus: "NS" },
  ],
}

/** Deliberately broken records for error-path tests. */
export const broken = {
  noTime: { ...eventDefaults, idEvent: "9000001", strEvent: "Everton vs Fulham", strTimestamp: null, dateEvent: "2026-09-19", strTime: null, idHomeTeam: "133615", idAwayTeam: "133600", strHomeTeam: "Everton", strAwayTeam: "Fulham", intHomeScore: null, intAwayScore: null, strStatus: "NS" } as RawEvent,
  noTeams: { ...eventDefaults, idEvent: "9000002", strEvent: "Unknown vs Unknown", strTimestamp: "2026-09-19T14:00:00", dateEvent: "2026-09-19", strTime: "14:00:00", idHomeTeam: null, idAwayTeam: null, strStatus: "NS" } as RawEvent,
  postponed: { ...eventDefaults, idEvent: "9000003", strEvent: "Arsenal vs Chelsea", strTimestamp: "2026-09-20T14:00:00", dateEvent: "2026-09-20", strTime: "14:00:00", idHomeTeam: "133604", idAwayTeam: "133610", strHomeTeam: "Arsenal", strAwayTeam: "Chelsea", intHomeScore: null, intAwayScore: null, strStatus: "PST", strPostponed: "yes" } as RawEvent,
  cancelled: { ...eventDefaults, idEvent: "9000004", strEvent: "Chelsea vs Brentford", strTimestamp: "2026-09-20T16:30:00", dateEvent: "2026-09-20", strTime: "16:30:00", idHomeTeam: "133610", idAwayTeam: "134355", strHomeTeam: "Chelsea", strAwayTeam: "Brentford", intHomeScore: null, intAwayScore: null, strStatus: "CANC" } as RawEvent,
  loneScore: { ...eventDefaults, idEvent: "9000005", strEvent: "Arsenal vs Brentford", strTimestamp: "2026-09-16T19:00:00", dateEvent: "2026-09-16", strTime: "19:00:00", idHomeTeam: "133604", idAwayTeam: "134355", strHomeTeam: "Arsenal", strAwayTeam: "Brentford", intHomeScore: "2", intAwayScore: null, strStatus: "FT" } as RawEvent,
  otherLeague: { ...eventDefaults, idEvent: "9000006", idLeague: "4335", strEvent: "Real Madrid vs Barcelona", strTimestamp: "2026-09-19T19:00:00", dateEvent: "2026-09-19", strTime: "19:00:00", idHomeTeam: "133738", idAwayTeam: "133739", strHomeTeam: "Real Madrid", strAwayTeam: "Barcelona", strStatus: "NS" } as RawEvent,
  otherSeason: { ...eventDefaults, idEvent: "9000007", strSeason: "2025-2026", strEvent: "Arsenal vs Chelsea", strTimestamp: "2026-05-24T15:00:00", dateEvent: "2026-05-24", strTime: "15:00:00", idHomeTeam: "133604", idAwayTeam: "133610", strHomeTeam: "Arsenal", strAwayTeam: "Chelsea", intHomeScore: "1", intAwayScore: "0", strStatus: "FT" } as RawEvent,
  sameTeam: { ...eventDefaults, idEvent: "9000008", strEvent: "Arsenal vs Arsenal", strTimestamp: "2026-09-19T14:00:00", dateEvent: "2026-09-19", strTime: "14:00:00", idHomeTeam: "133604", idAwayTeam: "133604", strHomeTeam: "Arsenal", strAwayTeam: "Arsenal", strStatus: "NS" } as RawEvent,
}

export type FakeApiOptions = {
  league?: unknown
  teams?: unknown
  season?: unknown
  next?: unknown
  past?: unknown
  days?: Record<string, unknown>
  lookups?: Record<string, unknown>
  /** Throw for matching paths, e.g. { "eventsday.php": new HttpError(429, …) }. */
  fail?: Record<string, Error>
  /** Fail the first N calls to a path, then succeed. */
  failOnce?: Record<string, Error>
}

/** In-memory TheSportsDB V1: the documented endpoints answered from the fixtures above. Records every call. */
export function fakeApi(options: FakeApiOptions = {}) {
  const calls: string[] = []
  const failed = new Set<string>()
  const request: JsonRequest = async <T>(url: string): Promise<T> => {
    calls.push(url)
    const u = new URL(url)
    const path = u.pathname.split("/").pop() ?? ""
    if (options.fail?.[path]) throw options.fail[path]
    if (options.failOnce?.[path] && !failed.has(path)) {
      failed.add(path)
      throw options.failOnce[path]
    }
    const respond = (body: unknown) => body as T
    switch (path) {
      case "lookupleague.php":
        return respond("league" in options ? options.league : { leagues: [league] })
      case "search_all_teams.php":
        return respond("teams" in options ? options.teams : { teams: teamList })
      case "eventsseason.php":
        return respond("season" in options ? options.season : { events: seasonEvents })
      case "eventsnextleague.php":
        return respond("next" in options ? options.next : { events: [nextEvent] })
      case "eventspastleague.php":
        return respond("past" in options ? options.past : { events: [pastEvent] })
      case "eventsday.php": {
        const day = u.searchParams.get("d") ?? ""
        const table = options.days ?? dayEvents
        return respond({ events: table[day] ?? null })
      }
      case "lookupteam.php": {
        const id = u.searchParams.get("id") ?? ""
        const table = options.lookups ?? teamLookups
        return respond(table[id] === undefined ? { teams: null } : { teams: [table[id]] })
      }
      default:
        throw new MalformedResponseError(url, `unexpected path ${path}`)
    }
  }
  return { request, calls }
}

export { HttpError }
