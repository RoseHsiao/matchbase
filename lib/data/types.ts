/**
 * Top-level domain. Sports and Esports are parallel categories; each sport or
 * game belongs to exactly one of them (see `sportMeta` in lib/sports.ts).
 */
export type Category = "sports" | "esports"

/** A traditional sport or an esports game. Each maps to a `Category`. */
export type Sport = "football" | "basketball" | "tennis" | "lol" | "valorant" | "cs2"

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
  /** Absent for individual-sport athletes, who belong to no team. */
  teamId?: string
  role: string
  nationality?: string
  /** Squad number for traditional sports. */
  number?: number
  status?: EntityStatus
}

/**
 * The two sides of a match. Side A is the home side when the sport has home
 * advantage (see `sportMeta`); otherwise the sides are first and second.
 */
export type MatchSide = "A" | "B"

/** Aggregate result per side in the sport's natural unit (points, sets, games, maps). */
export type MatchScore = {
  a: number
  b: number
}

/**
 * One competitor on one side: a team, or a single player. Two player
 * participants on a side form a doubles pair. Exactly one of `teamId` /
 * `playerId` is set.
 */
export type MatchParticipant = {
  id: string
  side: MatchSide
  /** Position within the side, from 1. */
  order: number
  teamId?: string
  playerId?: string
}

export type Match = {
  id: string
  leagueId: string
  /** Season the match belongs to. Always set for database-backed matches. */
  seasonId?: string
  /** Ordered by side then position. Every match has at least one participant per side. */
  participants: MatchParticipant[]
  /** ISO 8601 timestamp. */
  startsAt: string
  status: MatchStatus
  /** Round, week, or playoff stage label. */
  stage?: string
  /** Venue name for display, resolved from `venueId`. */
  venue?: string
  venueId?: string
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

export type SyncStatus = "running" | "success" | "failed" | "partial"
/** What a sync run touched. "all" is a full provider snapshot. */
export type SyncEntity = "all" | "matches" | "teams" | "players" | "leagues"

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

/**
 * When to remind the user about a watchlisted match, relative to its start.
 * "off" keeps the match on the watchlist without a reminder.
 */
export type WatchlistReminder = "off" | "at_start" | "5m" | "15m" | "30m" | "1h" | "1d"

/** One watchlist row: the saved match and its reminder preference. */
export type WatchlistEntry = {
  matchId: string
  reminder: WatchlistReminder
}

export type UserFollows = {
  teamIds: string[]
  playerIds: string[]
  leagueIds: string[]
  /** Saved match ids, in the order they were saved. */
  watchlistMatchIds: string[]
  /** Reminder per saved match id. Absent ids are "off". */
  watchlistReminders: Record<string, WatchlistReminder>
}

/** What the app shell needs about a watchlisted match to show reminders anywhere. */
export type WatchlistEntryView = WatchlistEntry & {
  title: string
  startsAt: string
  status: MatchStatus
  leagueShortName: string
  sport: Sport
}

/** A participant joined with the team or player it references. */
export type MatchParticipantView = MatchParticipant & {
  team?: Team
  player?: Player
}

/** A match joined with its league and its participants, ready to render. */
export type MatchView = Match & {
  league: League
  participants: MatchParticipantView[]
}

/**
 * A player joined with their team and league, ready to render. Individual
 * athletes have no team; their league is the competition they last played in.
 */
export type PlayerView = Player & {
  team?: Team
  league?: League
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
