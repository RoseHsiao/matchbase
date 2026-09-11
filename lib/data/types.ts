/**
 * Top-level domain. Sports and Esports are parallel categories; each sport or
 * game belongs to exactly one of them (see `sportMeta` in lib/sports.ts).
 */
export type Category = "sports" | "esports"

/** A traditional sport or an esports game. Each maps to a `Category`. */
export type Sport = "football" | "basketball" | "lol" | "valorant" | "cs2"

export type MatchStatus = "upcoming" | "live" | "finished"

export type League = {
  id: string
  name: string
  shortName: string
  sport: Sport
  region: string
  /** Current season label, e.g. "2026/27" or "Summer 2026". */
  season: string
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
