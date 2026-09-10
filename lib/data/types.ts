export type Sport = "football" | "basketball" | "lol" | "valorant" | "cs2"

export type MatchStatus = "upcoming" | "live" | "finished"

export type League = {
  id: string
  name: string
  shortName: string
  sport: Sport
  region: string
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
  handle?: string
  teamId: string
  role: string
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

export type TeamView = Team & {
  league: League
  nextMatch?: MatchView
}

export type QuickStats = {
  followedTeams: number
  followedPlayers: number
  followedLeagues: number
  watchlistMatches: number
  /** How many followed teams play today, shown as a hint. */
  teamsPlayingToday: number
  /** How many watchlisted matches are live right now. */
  watchlistLive: number
  /** Distinct sports across followed leagues, for display hints. */
  followedSports: Sport[]
}
