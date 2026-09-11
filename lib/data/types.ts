/**
 * Top-level domain. Sports and Esports are parallel categories; each sport or
 * game belongs to exactly one of them (see `sportMeta` in lib/sports.ts).
 */
export type Category = "sports" | "esports"

/** A traditional sport or an esports game. Each maps to a `Category`. */
export type Sport = "football" | "basketball" | "lol" | "valorant" | "cs2"

export type MatchStatus = "upcoming" | "live" | "finished"

/** Admin-managed lifecycle flag. Undefined means active. */
export type EntityStatus = "active" | "inactive"

export type League = {
  id: string
  name: string
  shortName: string
  sport: Sport
  region: string
  /** Current season label, e.g. "2026/27" or "Summer 2026". */
  season: string
  status?: EntityStatus
}

export type Team = {
  id: string
  name: string
  shortName: string
  /** Two or three letter code used by the logo placeholder. */
  code: string
  leagueId: string
  /** Brand colour for the logo placeholder. */
  color: string
  logoUrl?: string
  status?: EntityStatus
}

export type Player = {
  id: string
  name: string
  /** In-game name for esports players. */
  handle?: string
  teamId: string
  role: string
  nationality?: string
  /** Squad number for traditional sports. */
  number?: number
  status?: EntityStatus
}

export type MatchScore = {
  home: number
  away: number
}

export type Match = {
  id: string
  leagueId: string
  homeTeamId: string
  awayTeamId: string
  /** ISO 8601 timestamp. */
  startsAt: string
  status: MatchStatus
  /** Round, week, or playoff stage label. */
  stage?: string
  venue?: string
  score?: MatchScore
  /** Live-only detail such as "67'" or "Map 2". */
  liveDetail?: string
}

export type SeasonStatus = "current" | "upcoming" | "completed"

export type Season = {
  id: string
  leagueId: string
  name: string
  /** ISO dates (YYYY-MM-DD). */
  startsAt: string
  endsAt: string
  status: SeasonStatus
}

/** Physical venue for traditional sports. Esports matches may have none. */
export type Venue = {
  id: string
  name: string
  city: string
  country: string
  capacity?: number
  status: EntityStatus
}

export type DataSourceStatus = "connected" | "disconnected" | "attention"

export type DataSource = {
  id: string
  name: string
  /** Undefined for sources that span disciplines, such as manual import. */
  sport?: Sport
  status: DataSourceStatus
  lastSyncedAt?: string
}

export type SyncStatus = "success" | "failed" | "partial"
export type SyncEntity = "matches" | "teams" | "players" | "leagues"

export type SyncLog = {
  id: string
  dataSourceId: string
  entity: SyncEntity
  records: number
  status: SyncStatus
  durationMs: number
  at: string
}

export type AdminActivity = {
  id: string
  at: string
  action: string
  entity: string
  actor: string
}

/** Admin-managed status for a sport or game; the catalogue itself is code. */
export type SportRecord = {
  id: Sport
  status: EntityStatus
}

/** Everything the admin area manages, loaded once and held in client state. */
export type AdminData = {
  sports: SportRecord[]
  leagues: League[]
  seasons: Season[]
  teams: Team[]
  players: Player[]
  matches: Match[]
  venues: Venue[]
  dataSources: DataSource[]
  syncLogs: SyncLog[]
  activity: AdminActivity[]
}

export type UserFollows = {
  teamIds: string[]
  playerIds: string[]
  leagueIds: string[]
  watchlistMatchIds: string[]
}

/** A match joined with its league and both teams, ready to render. */
export type MatchView = Match & {
  league: League
  homeTeam: Team
  awayTeam: Team
}

/** A player joined with their team and league, ready to render. */
export type PlayerView = Player & {
  team: Team
  league: League
}

export type TeamView = Team & {
  league: League
  nextMatch?: MatchView
}

export type QuickStats = {
  followedLeagues: number
  /** Distinct sports across followed leagues, for display hints. */
  followedSports: Sport[]
}
