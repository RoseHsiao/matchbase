import type { League, Match, Player, Team, UserFollows } from "@/lib/data/types"

/**
 * Mock data for development. Match times are generated relative to "now" so
 * the dashboard always contains live, finished, and upcoming matches.
 * Replace with real queries once the data layer exists.
 */

export const leagues: League[] = [
  { id: "epl", name: "Premier League", shortName: "EPL", sport: "football", region: "England", season: "2026/27" },
  { id: "ucl", name: "UEFA Champions League", shortName: "UCL", sport: "football", region: "Europe", season: "2026/27" },
  { id: "nba", name: "NBA", shortName: "NBA", sport: "basketball", region: "North America", season: "2026-27" },
  { id: "lec", name: "LoL EMEA Championship", shortName: "LEC", sport: "lol", region: "Europe", season: "Summer 2026" },
  { id: "vct", name: "VCT Champions", shortName: "VCT", sport: "valorant", region: "International", season: "Champions 2026" },
  { id: "esl", name: "ESL Pro League", shortName: "ESL", sport: "cs2", region: "International", season: "Season 22" },
]

export const teams: Team[] = [
  // Football
  { id: "arsenal", name: "Arsenal", shortName: "Arsenal", code: "ARS", leagueId: "epl", color: "#EF0107" },
  { id: "liverpool", name: "Liverpool", shortName: "Liverpool", code: "LIV", leagueId: "epl", color: "#C8102E" },
  { id: "man-city", name: "Manchester City", shortName: "Man City", code: "MCI", leagueId: "epl", color: "#6CABDD" },
  { id: "chelsea", name: "Chelsea", shortName: "Chelsea", code: "CHE", leagueId: "epl", color: "#034694" },
  { id: "tottenham", name: "Tottenham Hotspur", shortName: "Spurs", code: "TOT", leagueId: "epl", color: "#132257" },
  { id: "real-madrid", name: "Real Madrid", shortName: "Real Madrid", code: "RMA", leagueId: "ucl", color: "#FEBE10" },
  { id: "bayern", name: "Bayern München", shortName: "Bayern", code: "FCB", leagueId: "ucl", color: "#DC052D" },
  // Basketball
  { id: "lakers", name: "Los Angeles Lakers", shortName: "Lakers", code: "LAL", leagueId: "nba", color: "#552583" },
  { id: "celtics", name: "Boston Celtics", shortName: "Celtics", code: "BOS", leagueId: "nba", color: "#007A33" },
  { id: "warriors", name: "Golden State Warriors", shortName: "Warriors", code: "GSW", leagueId: "nba", color: "#1D428A" },
  { id: "nuggets", name: "Denver Nuggets", shortName: "Nuggets", code: "DEN", leagueId: "nba", color: "#0E2240" },
  // League of Legends
  { id: "g2", name: "G2 Esports", shortName: "G2", code: "G2", leagueId: "lec", color: "#111111" },
  { id: "fnatic", name: "Fnatic", shortName: "Fnatic", code: "FNC", leagueId: "lec", color: "#FF5900" },
  { id: "kc", name: "Karmine Corp", shortName: "KC", code: "KC", leagueId: "lec", color: "#0A84FF" },
  { id: "mad", name: "MAD Lions KOI", shortName: "MAD", code: "MAD", leagueId: "lec", color: "#C9A227" },
  // Valorant
  { id: "sentinels", name: "Sentinels", shortName: "Sentinels", code: "SEN", leagueId: "vct", color: "#C8102E" },
  { id: "fut", name: "FUT Esports", shortName: "FUT", code: "FUT", leagueId: "vct", color: "#0F766E" },
  { id: "prx", name: "Paper Rex", shortName: "PRX", code: "PRX", leagueId: "vct", color: "#E11D48" },
  { id: "loud", name: "LOUD", shortName: "LOUD", code: "LLL", leagueId: "vct", color: "#16A34A" },
  // Counter-Strike
  { id: "navi", name: "Natus Vincere", shortName: "NAVI", code: "NAVI", leagueId: "esl", color: "#FFD700" },
  { id: "vitality", name: "Team Vitality", shortName: "Vitality", code: "VIT", leagueId: "esl", color: "#F5D000" },
  { id: "faze", name: "FaZe Clan", shortName: "FaZe", code: "FAZE", leagueId: "esl", color: "#E4002B" },
  { id: "spirit", name: "Team Spirit", shortName: "Spirit", code: "SPI", leagueId: "esl", color: "#2563EB" },
]

export const players: Player[] = [
  { id: "saka", name: "Bukayo Saka", teamId: "arsenal", role: "Right winger" },
  { id: "odegaard", name: "Martin Ødegaard", teamId: "arsenal", role: "Attacking midfielder" },
  { id: "salah", name: "Mohamed Salah", teamId: "liverpool", role: "Right winger" },
  { id: "tatum", name: "Jayson Tatum", teamId: "celtics", role: "Forward" },
  { id: "curry", name: "Stephen Curry", teamId: "warriors", role: "Point guard" },
  { id: "caps", name: "Rasmus Winther", handle: "Caps", teamId: "g2", role: "Mid" },
  { id: "tenz", name: "Tyson Ngo", handle: "TenZ", teamId: "sentinels", role: "Duelist" },
  { id: "zywoo", name: "Mathieu Herbaut", handle: "ZywOo", teamId: "vitality", role: "AWPer" },
  { id: "donk", name: "Danil Kryshkovets", handle: "donk", teamId: "spirit", role: "Rifler" },
]

/** Build an ISO timestamp `dayOffset` days from today at the given local time. */
function at(dayOffset: number, hour: number, minute = 0): string {
  const date = new Date()
  date.setDate(date.getDate() + dayOffset)
  date.setHours(hour, minute, 0, 0)
  return date.toISOString()
}

/** ISO timestamp `minutes` from now, used for live and just-finished matches. */
function fromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

export const matches: Match[] = [
  // Today: finished
  {
    id: "m-lec-g2-fnc",
    leagueId: "lec",
    homeTeamId: "g2",
    awayTeamId: "fnatic",
    startsAt: fromNow(-240),
    status: "finished",
    stage: "Playoffs · Upper final",
    venue: "LEC Studio, Berlin",
    score: { home: 3, away: 1 },
  },
  {
    id: "m-esl-navi-faze",
    leagueId: "esl",
    homeTeamId: "navi",
    awayTeamId: "faze",
    startsAt: fromNow(-180),
    status: "finished",
    stage: "Group A · Round 3",
    venue: "ESL Studios, Stockholm",
    score: { home: 2, away: 0 },
  },
  // Today: live
  {
    id: "m-epl-ars-che",
    leagueId: "epl",
    homeTeamId: "arsenal",
    awayTeamId: "chelsea",
    startsAt: fromNow(-67),
    status: "live",
    stage: "Matchweek 4",
    venue: "Emirates Stadium",
    score: { home: 2, away: 1 },
    liveDetail: "67'",
  },
  {
    id: "m-vct-sen-prx",
    leagueId: "vct",
    homeTeamId: "sentinels",
    awayTeamId: "prx",
    startsAt: fromNow(-45),
    status: "live",
    stage: "Quarterfinal",
    venue: "Accor Arena, Paris",
    score: { home: 1, away: 1 },
    liveDetail: "Map 3",
  },
  // Today: upcoming
  {
    id: "m-epl-liv-mci",
    leagueId: "epl",
    homeTeamId: "liverpool",
    awayTeamId: "man-city",
    startsAt: fromNow(150),
    status: "upcoming",
    stage: "Matchweek 4",
    venue: "Anfield",
  },
  {
    id: "m-esl-vit-spi",
    leagueId: "esl",
    homeTeamId: "vitality",
    awayTeamId: "spirit",
    startsAt: fromNow(210),
    status: "upcoming",
    stage: "Group B · Round 3",
    venue: "ESL Studios, Stockholm",
  },
  {
    id: "m-nba-lal-bos",
    leagueId: "nba",
    homeTeamId: "lakers",
    awayTeamId: "celtics",
    startsAt: fromNow(330),
    status: "upcoming",
    stage: "Regular season",
    venue: "Crypto.com Arena",
  },
  // Tomorrow
  {
    id: "m-ucl-rma-fcb",
    leagueId: "ucl",
    homeTeamId: "real-madrid",
    awayTeamId: "bayern",
    startsAt: at(1, 21, 0),
    status: "upcoming",
    stage: "Group stage · Matchday 1",
    venue: "Santiago Bernabéu",
  },
  {
    id: "m-lec-kc-mad",
    leagueId: "lec",
    homeTeamId: "kc",
    awayTeamId: "mad",
    startsAt: at(1, 18, 0),
    status: "upcoming",
    stage: "Playoffs · Lower final",
    venue: "LEC Studio, Berlin",
  },
  {
    id: "m-nba-gsw-den",
    leagueId: "nba",
    homeTeamId: "warriors",
    awayTeamId: "nuggets",
    startsAt: at(1, 19, 30),
    status: "upcoming",
    stage: "Regular season",
    venue: "Chase Center",
  },
  // Later this week
  {
    id: "m-vct-fut-loud",
    leagueId: "vct",
    homeTeamId: "fut",
    awayTeamId: "loud",
    startsAt: at(2, 17, 0),
    status: "upcoming",
    stage: "Quarterfinal",
    venue: "Accor Arena, Paris",
  },
  {
    id: "m-epl-tot-ars",
    leagueId: "epl",
    homeTeamId: "tottenham",
    awayTeamId: "arsenal",
    startsAt: at(3, 16, 30),
    status: "upcoming",
    stage: "Matchweek 5",
    venue: "Tottenham Hotspur Stadium",
  },
  {
    id: "m-esl-faze-vit",
    leagueId: "esl",
    homeTeamId: "faze",
    awayTeamId: "vitality",
    startsAt: at(4, 20, 0),
    status: "upcoming",
    stage: "Playoffs · Quarterfinal",
    venue: "ESL Studios, Stockholm",
  },
  {
    id: "m-lec-g2-kc",
    leagueId: "lec",
    homeTeamId: "g2",
    awayTeamId: "kc",
    startsAt: at(6, 17, 0),
    status: "upcoming",
    stage: "Playoffs · Grand final",
    venue: "Uber Arena, Berlin",
  },
  // Recent history
  {
    id: "m-epl-mci-tot",
    leagueId: "epl",
    homeTeamId: "man-city",
    awayTeamId: "tottenham",
    startsAt: at(-2, 20, 0),
    status: "finished",
    stage: "Matchweek 3",
    score: { home: 1, away: 1 },
  },
  {
    id: "m-nba-bos-gsw",
    leagueId: "nba",
    homeTeamId: "celtics",
    awayTeamId: "warriors",
    startsAt: at(-1, 19, 30),
    status: "finished",
    stage: "Regular season",
    score: { home: 112, away: 104 },
  },
]

export const currentUserFollows: UserFollows = {
  teamIds: ["arsenal", "liverpool", "celtics", "g2", "sentinels", "vitality"],
  playerIds: ["saka", "salah", "tatum", "caps", "tenz", "zywoo"],
  leagueIds: ["epl", "nba", "lec", "vct"],
  watchlistMatchIds: [
    "m-epl-ars-che",
    "m-epl-liv-mci",
    "m-ucl-rma-fcb",
    "m-lec-g2-kc",
    "m-esl-faze-vit",
  ],
}
