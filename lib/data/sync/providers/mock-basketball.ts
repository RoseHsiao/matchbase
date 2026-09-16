import type {
  NormalizedMatch,
  NormalizedMatchStatus,
  NormalizedSnapshot,
  Provider,
  SyncContext,
  SyncIssue,
} from "@/lib/data/sync/types"
import { RateLimiter, sleep } from "@/lib/data/sync/utils/http"

/**
 * Deterministic stand-in for an external basketball feed.
 *
 * It behaves like a real provider: its own ids (numeric strings, nothing like
 * MatchBase's slugs), its own field names, its own status vocabulary, paged
 * fixture requests with a rate limit, and a couple of records that exercise
 * the pipeline's error paths. Only the transport is fake.
 *
 * To plug in a real feed, write another adapter with the same `Provider`
 * shape: `fetch` calls the API (see utils/http.ts), `normalize` maps its
 * payload to the normalized types. Register it in providers/registry.ts and
 * bind a DataSource to it. Nothing else changes.
 *
 * Deliberate imperfections in the feed:
 * - game 5008 has status "PPD" (postponed), which has no MatchBase equivalent,
 *   so it normalizes to `unknown` with a warning;
 * - game 5009 references visitor team 999, which does not exist, so its
 *   upsert fails and the run ends PARTIAL. That makes the Data Sources page
 *   show "Needs attention" for this feed, which is the intended signal.
 */

// ---------------------------------------------------------------------------
// Raw provider payload (private to this adapter)
// ---------------------------------------------------------------------------

type RawLeague = { id: number; league_name: string; abbrev: string; country: string }
type RawSeason = { id: number; league_id: number; label: string; start: string; end: string; is_current: boolean }
type RawTeam = { id: number; league_id: number; full_name: string; nick: string; tricode: string; primary_color: string }
type RawPlayer = { id: number; team_id: number; display_name: string; position: string; jersey: number; country: string }
type RawVenue = { id: number; name: string; city: string; country: string; seats: number }
type RawGameState = "SCHED" | "INPLAY" | "FT" | "PPD"
type RawGame = {
  id: number
  league_id: number
  season_id: number
  home_id: number
  visitor_id: number
  venue_id: number | null
  /** Provider timestamp: ISO 8601 in UTC. */
  tipoff_utc: string
  state: RawGameState
  round: string
  home_pts: number | null
  visitor_pts: number | null
  clock: string | null
}

export type MockBasketballPayload = {
  leagues: RawLeague[]
  seasons: RawSeason[]
  teams: RawTeam[]
  players: RawPlayer[]
  venues: RawVenue[]
  games: RawGame[]
}

// ---------------------------------------------------------------------------
// The "remote" dataset
// ---------------------------------------------------------------------------

const LEAGUE_ID = 1001
const SEASON_ID = 2001

const leagues: RawLeague[] = [{ id: LEAGUE_ID, league_name: "Mock Basketball League", abbrev: "MBL", country: "Testland" }]

const teams: RawTeam[] = [
  { id: 3001, league_id: LEAGUE_ID, full_name: "Harbor City Hawks", nick: "Hawks", tricode: "HCH", primary_color: "#0EA5E9" },
  { id: 3002, league_id: LEAGUE_ID, full_name: "Ridgeview Rockets", nick: "Rockets", tricode: "RVR", primary_color: "#F97316" },
  { id: 3003, league_id: LEAGUE_ID, full_name: "Summit Peaks", nick: "Peaks", tricode: "SMP", primary_color: "#16A34A" },
  { id: 3004, league_id: LEAGUE_ID, full_name: "Lakeside Lynx", nick: "Lynx", tricode: "LSL", primary_color: "#7C3AED" },
]

const players: RawPlayer[] = [
  { id: 4001, team_id: 3001, display_name: "Avery Cole", position: "Guard", jersey: 3, country: "Testland" },
  { id: 4002, team_id: 3001, display_name: "Jordan Reyes", position: "Center", jersey: 15, country: "Testland" },
  { id: 4003, team_id: 3002, display_name: "Sam Okafor", position: "Forward", jersey: 21, country: "Testland" },
  { id: 4004, team_id: 3002, display_name: "Riley Chen", position: "Guard", jersey: 7, country: "Testland" },
  { id: 4005, team_id: 3003, display_name: "Casey Novak", position: "Forward", jersey: 11, country: "Testland" },
  { id: 4006, team_id: 3003, display_name: "Morgan Diaz", position: "Guard", jersey: 1, country: "Testland" },
  { id: 4007, team_id: 3004, display_name: "Taylor Brooks", position: "Center", jersey: 33, country: "Testland" },
  { id: 4008, team_id: 3004, display_name: "Quinn Adebayo", position: "Guard", jersey: 9, country: "Testland" },
]

const venues: RawVenue[] = [
  { id: 6001, name: "Harbor Arena", city: "Harbor City", country: "Testland", seats: 15000 },
  { id: 6002, name: "Summit Dome", city: "Summit", country: "Testland", seats: 12000 },
]

/** Fixtures relative to the run's reference time, rounded to the hour so runs stay comparable. */
function gamesRelativeTo(now: Date): RawGame[] {
  const base = new Date(now)
  base.setUTCMinutes(0, 0, 0)
  const at = (hours: number) => new Date(base.getTime() + hours * 3_600_000).toISOString()
  return [
    { id: 5001, league_id: LEAGUE_ID, season_id: SEASON_ID, home_id: 3001, visitor_id: 3002, venue_id: 6001, tipoff_utc: at(-26), state: "FT", round: "Round 1", home_pts: 98, visitor_pts: 91, clock: null },
    { id: 5002, league_id: LEAGUE_ID, season_id: SEASON_ID, home_id: 3003, visitor_id: 3004, venue_id: 6002, tipoff_utc: at(-25), state: "FT", round: "Round 1", home_pts: 87, visitor_pts: 102, clock: null },
    { id: 5003, league_id: LEAGUE_ID, season_id: SEASON_ID, home_id: 3002, visitor_id: 3003, venue_id: null, tipoff_utc: at(-1), state: "INPLAY", round: "Round 2", home_pts: 54, visitor_pts: 49, clock: "Q3 04:12" },
    { id: 5004, league_id: LEAGUE_ID, season_id: SEASON_ID, home_id: 3004, visitor_id: 3001, venue_id: 6001, tipoff_utc: at(5), state: "SCHED", round: "Round 2", home_pts: null, visitor_pts: null, clock: null },
    { id: 5005, league_id: LEAGUE_ID, season_id: SEASON_ID, home_id: 3001, visitor_id: 3003, venue_id: 6001, tipoff_utc: at(29), state: "SCHED", round: "Round 3", home_pts: null, visitor_pts: null, clock: null },
    { id: 5006, league_id: LEAGUE_ID, season_id: SEASON_ID, home_id: 3002, visitor_id: 3004, venue_id: 6002, tipoff_utc: at(31), state: "SCHED", round: "Round 3", home_pts: null, visitor_pts: null, clock: null },
    { id: 5007, league_id: LEAGUE_ID, season_id: SEASON_ID, home_id: 3003, visitor_id: 3001, venue_id: 6002, tipoff_utc: at(53), state: "SCHED", round: "Round 4", home_pts: null, visitor_pts: null, clock: null },
    { id: 5008, league_id: LEAGUE_ID, season_id: SEASON_ID, home_id: 3004, visitor_id: 3002, venue_id: 6001, tipoff_utc: at(55), state: "PPD", round: "Round 4", home_pts: null, visitor_pts: null, clock: null },
    { id: 5009, league_id: LEAGUE_ID, season_id: SEASON_ID, home_id: 3001, visitor_id: 999, venue_id: null, tipoff_utc: at(77), state: "SCHED", round: "Round 5", home_pts: null, visitor_pts: null, clock: null },
  ]
}

function seasonsRelativeTo(now: Date): RawSeason[] {
  const year = now.getUTCFullYear()
  return [{ id: SEASON_ID, league_id: LEAGUE_ID, label: `${year} Season`, start: `${year}-01-10`, end: `${year}-12-20`, is_current: true }]
}

// ---------------------------------------------------------------------------
// Transport simulation: paged fixture endpoint behind a rate limit
// ---------------------------------------------------------------------------

const PAGE_SIZE = 4
const limiter = new RateLimiter(20)

async function requestGamesPage(all: RawGame[], page: number, signal?: AbortSignal): Promise<{ items: RawGame[]; nextPage: number | null }> {
  await limiter.wait()
  await sleep(5, signal)
  const start = page * PAGE_SIZE
  const items = all.slice(start, start + PAGE_SIZE)
  return { items, nextPage: start + PAGE_SIZE < all.length ? page + 1 : null }
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/** Provider status vocabulary -> MatchBase. Anything else is `unknown` and is reported. */
const STATUS_MAP: Record<string, NormalizedMatchStatus> = {
  SCHED: "upcoming",
  INPLAY: "live",
  FT: "finished",
}

const ext = (id: number) => String(id)

export const mockBasketballProvider: Provider<MockBasketballPayload> = {
  key: "mock-basketball",
  name: "Mock Basketball Feed",
  sport: "basketball",
  kind: "mock",
  checkConfiguration: () => ({ configured: true }),

  async fetch(context: SyncContext) {
    const all = gamesRelativeTo(context.now)
    const games: RawGame[] = []
    let page: number | null = 0
    while (page !== null) {
      const result = await requestGamesPage(all, page, context.signal)
      games.push(...result.items)
      page = result.nextPage
    }
    return { leagues, seasons: seasonsRelativeTo(context.now), teams, players, venues, games }
  },

  normalize(raw: MockBasketballPayload): NormalizedSnapshot {
    const issues: SyncIssue[] = []
    const matches: NormalizedMatch[] = raw.games.map((game) => {
      const status = STATUS_MAP[game.state] ?? "unknown"
      if (status === "unknown") {
        issues.push({ level: "warning", entity: "match", externalId: ext(game.id), message: `Unmapped provider status "${game.state}"; existing status kept or defaulted to upcoming.` })
      }
      const hasScore = game.home_pts !== null && game.visitor_pts !== null
      return {
        externalId: ext(game.id),
        leagueExternalId: ext(game.league_id),
        seasonExternalId: ext(game.season_id),
        homeTeamExternalId: ext(game.home_id),
        awayTeamExternalId: ext(game.visitor_id),
        venueExternalId: game.venue_id === null ? undefined : ext(game.venue_id),
        startsAt: game.tipoff_utc,
        status,
        rawStatus: game.state,
        stage: game.round,
        homeScore: hasScore ? (game.home_pts as number) : undefined,
        awayScore: hasScore ? (game.visitor_pts as number) : undefined,
        liveDetail: status === "live" ? (game.clock ?? undefined) : undefined,
      }
    })

    return {
      leagues: raw.leagues.map((league) => ({ externalId: ext(league.id), sport: "basketball", name: league.league_name, shortName: league.abbrev, region: league.country })),
      seasons: raw.seasons.map((season) => ({ externalId: ext(season.id), leagueExternalId: ext(season.league_id), name: season.label, startsAt: season.start, endsAt: season.end, status: season.is_current ? "current" : "completed" })),
      teams: raw.teams.map((team) => ({ externalId: ext(team.id), leagueExternalId: ext(team.league_id), name: team.full_name, shortName: team.nick, code: team.tricode, color: team.primary_color })),
      players: raw.players.map((player) => ({ externalId: ext(player.id), teamExternalId: ext(player.team_id), name: player.display_name, role: player.position, number: player.jersey, nationality: player.country })),
      venues: raw.venues.map((venue) => ({ externalId: ext(venue.id), name: venue.name, city: venue.city, country: venue.country, capacity: venue.seats })),
      matches,
      issues,
    }
  },
}
