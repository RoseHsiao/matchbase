import type {
  AdminActivity,
  DataSource,
  League,
  Match,
  MatchParticipant,
  Player,
  Season,
  SyncLog,
  Team,
  UserFollows,
  Venue,
} from "@/lib/data/types"
import { createDemoClock, resolveDemoAnchor, type DemoClock } from "@/lib/demo-clock"

/**
 * Demo dataset: the catalogue, the demo user's follows, and a *timeline* of
 * matches, feeds and logs written as offsets from an anchor ("67 minutes
 * before", "tomorrow at 21:00 Taipei"). `buildDemoData(clock)` lays that
 * timeline over any anchor (lib/demo-clock.ts); the seed uses the real date
 * (or DEMO_ANCHOR) so the demo never ages out, tests use a fixed anchor so
 * they never read the wall clock. Entity ids are fixed slugs and never
 * depend on time. Real provider rows are not part of this file.
 */

export const leagues: League[] = [
  { id: "epl", name: "Premier League", shortName: "EPL", sport: "football", region: "England", season: "2026/27" },
  { id: "ucl", name: "UEFA Champions League", shortName: "UCL", sport: "football", region: "Europe", season: "2026/27" },
  { id: "nba", name: "NBA", shortName: "NBA", sport: "basketball", region: "North America", season: "2026-27" },
  { id: "lec", name: "LoL EMEA Championship", shortName: "LEC", sport: "lol", region: "Europe", season: "Summer 2026" },
  { id: "lck", name: "LCK", shortName: "LCK", sport: "lol", region: "South Korea", season: "2026 Season" },
  { id: "vct", name: "VCT Champions", shortName: "VCT", sport: "valorant", region: "International", season: "Champions 2026" },
  { id: "esl", name: "ESL Pro League", shortName: "ESL", sport: "cs2", region: "International", season: "Season 22" },
  // Individual sport: no teams; matches are between players (singles) or pairs (doubles).
  { id: "wimbledon", name: "The Championships, Wimbledon", shortName: "Wimbledon", sport: "tennis", region: "United Kingdom", season: "2026" },
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
  { id: "t1", name: "T1", shortName: "T1", code: "T1", leagueId: "lck", color: "#E4002B" },
  { id: "geng", name: "Gen.G", shortName: "Gen.G", code: "GEN", leagueId: "lck", color: "#AA8B56" },
  { id: "hle", name: "Hanwha Life Esports", shortName: "HLE", code: "HLE", leagueId: "lck", color: "#F47B20" },
  { id: "dk", name: "Dplus KIA", shortName: "DK", code: "DK", leagueId: "lck", color: "#1B1B1B" },
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
  // Football
  { id: "saka", name: "Bukayo Saka", teamId: "arsenal", role: "Right winger", nationality: "England", number: 7 },
  { id: "odegaard", name: "Martin Ødegaard", teamId: "arsenal", role: "Attacking midfielder", nationality: "Norway", number: 8 },
  { id: "salah", name: "Mohamed Salah", teamId: "liverpool", role: "Right winger", nationality: "Egypt", number: 11 },
  { id: "palmer", name: "Cole Palmer", teamId: "chelsea", role: "Attacking midfielder", nationality: "England", number: 20 },
  { id: "haaland", name: "Erling Haaland", teamId: "man-city", role: "Striker", nationality: "Norway", number: 9 },
  { id: "bellingham", name: "Jude Bellingham", teamId: "real-madrid", role: "Midfielder", nationality: "England", number: 5 },
  { id: "kane", name: "Harry Kane", teamId: "bayern", role: "Striker", nationality: "England", number: 9 },
  // Basketball
  { id: "tatum", name: "Jayson Tatum", teamId: "celtics", role: "Forward", nationality: "United States", number: 0 },
  { id: "curry", name: "Stephen Curry", teamId: "warriors", role: "Point guard", nationality: "United States", number: 30 },
  { id: "lebron", name: "LeBron James", teamId: "lakers", role: "Forward", nationality: "United States", number: 23 },
  { id: "jokic", name: "Nikola Jokić", teamId: "nuggets", role: "Center", nationality: "Serbia", number: 15 },
  // League of Legends
  { id: "caps", name: "Rasmus Winther", handle: "Caps", teamId: "g2", role: "Mid", nationality: "Denmark" },
  { id: "razork", name: "Iván Martín Díaz", handle: "Razork", teamId: "fnatic", role: "Jungle", nationality: "Spain" },
  { id: "targamas", name: "Raphaël Crabbé", handle: "Targamas", teamId: "kc", role: "Support", nationality: "Belgium" },
  { id: "faker", name: "Lee Sang-hyeok", handle: "Faker", teamId: "t1", role: "Mid", nationality: "South Korea" },
  { id: "chovy", name: "Jeong Ji-hoon", handle: "Chovy", teamId: "geng", role: "Mid", nationality: "South Korea" },
  { id: "zeka", name: "Kim Geon-woo", handle: "Zeka", teamId: "hle", role: "Mid", nationality: "South Korea" },
  { id: "showmaker", name: "Heo Su", handle: "ShowMaker", teamId: "dk", role: "Mid", nationality: "South Korea" },
  // Valorant
  { id: "tenz", name: "Tyson Ngo", handle: "TenZ", teamId: "sentinels", role: "Duelist", nationality: "Canada" },
  { id: "f0rsaken", name: "Jason Susanto", handle: "f0rsakeN", teamId: "prx", role: "Duelist", nationality: "Indonesia" },
  // Counter-Strike
  { id: "zywoo", name: "Mathieu Herbaut", handle: "ZywOo", teamId: "vitality", role: "AWPer", nationality: "France" },
  { id: "donk", name: "Danil Kryshkovets", handle: "donk", teamId: "spirit", role: "Rifler", nationality: "Russia" },
  { id: "ropz", name: "Robin Kool", handle: "ropz", teamId: "faze", role: "Rifler", nationality: "Estonia" },
  // Tennis: individual athletes belong to no team.
  { id: "alcaraz", name: "Carlos Alcaraz", role: "Singles", nationality: "Spain" },
  { id: "sinner", name: "Jannik Sinner", role: "Singles", nationality: "Italy" },
  { id: "hsieh", name: "Hsieh Su-wei", role: "Doubles", nationality: "Chinese Taipei" },
  { id: "ostapenko", name: "Jeļena Ostapenko", role: "Doubles", nationality: "Latvia" },
  { id: "siniakova", name: "Kateřina Siniaková", role: "Doubles", nationality: "Czechia" },
  { id: "townsend", name: "Taylor Townsend", role: "Doubles", nationality: "United States" },
]

/** ISO evaluators for one clock: `at(dayOffset, hour, minute)` in the demo zone, `fromNow(minutes)` from the anchor. */
function evaluators(clock: DemoClock) {
  return {
    at: (dayOffset: number, hour: number, minute = 0): string => clock.at(dayOffset, hour, minute).toISOString(),
    fromNow: (minutes: number): string => clock.fromAnchor(minutes).toISOString(),
  }
}

/** One team per side: side A first. Participant ids are derived from the match id so they stay stable. */
function teamSides(matchId: string, sideA: string, sideB: string): MatchParticipant[] {
  return [
    { id: `${matchId}-A1`, side: "A", order: 1, teamId: sideA },
    { id: `${matchId}-B1`, side: "B", order: 1, teamId: sideB },
  ]
}

/** Player sides for individual sports: one player for singles, two for doubles, in listed order. */
function playerSides(matchId: string, sideA: string[], sideB: string[]): MatchParticipant[] {
  const side = (key: "A" | "B", ids: string[]) =>
    ids.map((playerId, index) => ({ id: `${matchId}-${key}${index + 1}`, side: key, order: index + 1, playerId }))
  return [...side("A", sideA), ...side("B", sideB)]
}

/** The match timeline. Statuses are authored to match their offsets; lib/data/demo-consistency.ts checks that for any anchor. */
export function buildMatches(clock: DemoClock): Match[] {
  const { at, fromNow } = evaluators(clock)
  return [
  // Today: finished
  {
    id: "m-lec-g2-fnc",
    leagueId: "lec",
    participants: teamSides("m-lec-g2-fnc", "g2", "fnatic"),
    startsAt: fromNow(-240),
    status: "finished",
    stage: "Playoffs · Upper final",
    venue: "LEC Studio, Berlin",
    score: { a: 3, b: 1 },
  },
  {
    id: "m-esl-navi-faze",
    leagueId: "esl",
    participants: teamSides("m-esl-navi-faze", "navi", "faze"),
    startsAt: fromNow(-180),
    status: "finished",
    stage: "Group A · Round 3",
    venue: "ESL Studios, Stockholm",
    score: { a: 2, b: 0 },
  },
  // Today: live
  {
    id: "m-epl-ars-che",
    leagueId: "epl",
    participants: teamSides("m-epl-ars-che", "arsenal", "chelsea"),
    startsAt: fromNow(-67),
    status: "live",
    stage: "Matchweek 4",
    venue: "Emirates Stadium",
    score: { a: 2, b: 1 },
    liveDetail: "67'",
  },
  {
    id: "m-vct-sen-prx",
    leagueId: "vct",
    participants: teamSides("m-vct-sen-prx", "sentinels", "prx"),
    startsAt: fromNow(-45),
    status: "live",
    stage: "Quarterfinal",
    venue: "Accor Arena, Paris",
    score: { a: 1, b: 1 },
    liveDetail: "Map 3",
  },
  // Today: upcoming
  {
    id: "m-epl-liv-mci",
    leagueId: "epl",
    participants: teamSides("m-epl-liv-mci", "liverpool", "man-city"),
    startsAt: fromNow(150),
    status: "upcoming",
    stage: "Matchweek 4",
    venue: "Anfield",
  },
  {
    id: "m-esl-vit-spi",
    leagueId: "esl",
    participants: teamSides("m-esl-vit-spi", "vitality", "spirit"),
    startsAt: fromNow(210),
    status: "upcoming",
    stage: "Group B · Round 3",
    venue: "ESL Studios, Stockholm",
  },
  {
    id: "m-nba-lal-bos",
    leagueId: "nba",
    participants: teamSides("m-nba-lal-bos", "lakers", "celtics"),
    startsAt: fromNow(330),
    status: "upcoming",
    stage: "Regular season",
    venue: "Crypto.com Arena",
  },
  // Tomorrow
  {
    id: "m-ucl-rma-fcb",
    leagueId: "ucl",
    participants: teamSides("m-ucl-rma-fcb", "real-madrid", "bayern"),
    startsAt: at(1, 21, 0),
    status: "upcoming",
    stage: "Group stage · Matchday 1",
    venue: "Santiago Bernabéu",
  },
  {
    id: "m-lec-kc-mad",
    leagueId: "lec",
    participants: teamSides("m-lec-kc-mad", "kc", "mad"),
    startsAt: at(1, 18, 0),
    status: "upcoming",
    stage: "Playoffs · Lower final",
    venue: "LEC Studio, Berlin",
  },
  {
    id: "m-nba-gsw-den",
    leagueId: "nba",
    participants: teamSides("m-nba-gsw-den", "warriors", "nuggets"),
    startsAt: at(1, 19, 30),
    status: "upcoming",
    stage: "Regular season",
    venue: "Chase Center",
  },
  // Later this week
  {
    id: "m-vct-fut-loud",
    leagueId: "vct",
    participants: teamSides("m-vct-fut-loud", "fut", "loud"),
    startsAt: at(2, 17, 0),
    status: "upcoming",
    stage: "Quarterfinal",
    venue: "Accor Arena, Paris",
  },
  {
    id: "m-epl-tot-ars",
    leagueId: "epl",
    participants: teamSides("m-epl-tot-ars", "tottenham", "arsenal"),
    startsAt: at(3, 16, 30),
    status: "upcoming",
    stage: "Matchweek 5",
    venue: "Tottenham Hotspur Stadium",
  },
  {
    id: "m-esl-faze-vit",
    leagueId: "esl",
    participants: teamSides("m-esl-faze-vit", "faze", "vitality"),
    startsAt: at(4, 20, 0),
    status: "upcoming",
    stage: "Playoffs · Quarterfinal",
    venue: "ESL Studios, Stockholm",
  },
  {
    id: "m-lec-g2-kc",
    leagueId: "lec",
    participants: teamSides("m-lec-g2-kc", "g2", "kc"),
    startsAt: at(6, 17, 0),
    status: "upcoming",
    stage: "Playoffs · Grand final",
    venue: "Uber Arena, Berlin",
  },
  // LCK
  {
    id: "m-lck-t1-geng",
    leagueId: "lck",
    participants: teamSides("m-lck-t1-geng", "t1", "geng"),
    startsAt: fromNow(90),
    status: "upcoming",
    stage: "Regular season · Week 6",
    venue: "LoL Park, Seoul",
  },
  {
    id: "m-lck-hle-dk",
    leagueId: "lck",
    participants: teamSides("m-lck-hle-dk", "hle", "dk"),
    startsAt: at(1, 17, 0),
    status: "upcoming",
    stage: "Regular season · Week 6",
    venue: "LoL Park, Seoul",
  },
  {
    id: "m-lck-geng-dk",
    leagueId: "lck",
    participants: teamSides("m-lck-geng-dk", "geng", "dk"),
    startsAt: at(3, 17, 0),
    status: "upcoming",
    stage: "Regular season · Week 7",
    venue: "LoL Park, Seoul",
  },
  {
    id: "m-lck-t1-hle",
    leagueId: "lck",
    participants: teamSides("m-lck-t1-hle", "t1", "hle"),
    startsAt: at(-1, 17, 0),
    status: "finished",
    stage: "Regular season · Week 5",
    venue: "LoL Park, Seoul",
    score: { a: 2, b: 0 },
  },
  // Recent history
  {
    id: "m-epl-mci-tot",
    leagueId: "epl",
    participants: teamSides("m-epl-mci-tot", "man-city", "tottenham"),
    startsAt: at(-2, 20, 0),
    status: "finished",
    stage: "Matchweek 3",
    score: { a: 1, b: 1 },
  },
  {
    id: "m-nba-bos-gsw",
    leagueId: "nba",
    participants: teamSides("m-nba-bos-gsw", "celtics", "warriors"),
    startsAt: at(-1, 19, 30),
    status: "finished",
    stage: "Regular season",
    score: { a: 112, b: 104 },
  },
  // Tennis: singles (one player per side) and doubles (two players per side). No Home/Away.
  {
    id: "m-wim-alcaraz-sinner",
    leagueId: "wimbledon",
    participants: playerSides("m-wim-alcaraz-sinner", ["alcaraz"], ["sinner"]),
    startsAt: at(-1, 14, 0),
    status: "finished",
    stage: "Gentlemen's singles · Final",
    venue: "Centre Court, Wimbledon",
    score: { a: 3, b: 1 },
  },
  {
    id: "m-wim-sinner-alcaraz-exh",
    leagueId: "wimbledon",
    participants: playerSides("m-wim-sinner-alcaraz-exh", ["sinner"], ["alcaraz"]),
    startsAt: at(3, 15, 0),
    status: "upcoming",
    stage: "Exhibition",
    venue: "Centre Court, Wimbledon",
  },
  {
    id: "m-wim-doubles-final",
    leagueId: "wimbledon",
    participants: playerSides("m-wim-doubles-final", ["hsieh", "ostapenko"], ["siniakova", "townsend"]),
    startsAt: at(2, 13, 0),
    status: "upcoming",
    stage: "Ladies' doubles · Final",
    venue: "Centre Court, Wimbledon",
  },
  ]
}

export const currentUserFollows: UserFollows = {
  teamIds: ["arsenal", "liverpool", "celtics", "g2", "t1", "sentinels", "vitality"],
  playerIds: ["saka", "salah", "tatum", "caps", "faker", "tenz", "zywoo", "alcaraz"],
  leagueIds: ["epl", "nba", "lec", "lck", "vct"],
  watchlistMatchIds: [
    "m-epl-ars-che",
    "m-lck-t1-geng",
    "m-lck-t1-hle",
    "m-epl-liv-mci",
    "m-ucl-rma-fcb",
    "m-lec-g2-kc",
    "m-esl-faze-vit",
  ],
  // Demo reminder preferences: only upcoming matches carry one; the rest are off.
  watchlistReminders: {
    "m-epl-liv-mci": "15m",
    "m-ucl-rma-fcb": "1h",
    "m-lec-g2-kc": "at_start",
    "m-esl-faze-vit": "1d",
  },
}

export const seasons: Season[] = [
  { id: "s-epl-2627", leagueId: "epl", name: "2026/27", startsAt: "2026-08-15", endsAt: "2027-05-23", status: "current" },
  { id: "s-epl-2526", leagueId: "epl", name: "2025/26", startsAt: "2025-08-16", endsAt: "2026-05-24", status: "completed" },
  { id: "s-ucl-2627", leagueId: "ucl", name: "2026/27", startsAt: "2026-09-15", endsAt: "2027-05-29", status: "current" },
  { id: "s-nba-2627", leagueId: "nba", name: "2026-27", startsAt: "2026-10-20", endsAt: "2027-06-20", status: "current" },
  { id: "s-nba-2526", leagueId: "nba", name: "2025-26", startsAt: "2025-10-21", endsAt: "2026-06-19", status: "completed" },
  { id: "s-lec-summer26", leagueId: "lec", name: "Summer 2026", startsAt: "2026-06-06", endsAt: "2026-09-20", status: "current" },
  { id: "s-lck-2026", leagueId: "lck", name: "2026 Season", startsAt: "2026-01-14", endsAt: "2026-09-27", status: "current" },
  { id: "s-lck-2027", leagueId: "lck", name: "2027 Season", startsAt: "2027-01-13", endsAt: "2027-09-26", status: "upcoming" },
  { id: "s-vct-champ26", leagueId: "vct", name: "Champions 2026", startsAt: "2026-08-28", endsAt: "2026-09-20", status: "current" },
  { id: "s-esl-22", leagueId: "esl", name: "Season 22", startsAt: "2026-09-01", endsAt: "2026-09-27", status: "current" },
  { id: "s-wim-2026", leagueId: "wimbledon", name: "2026", startsAt: "2026-06-29", endsAt: "2026-07-12", status: "current" },
]

/** Venues are matched to `Match.venue` by name until matches carry a venue id. */
export const venues: Venue[] = [
  { id: "v-emirates", name: "Emirates Stadium", city: "London", country: "England", capacity: 60704, status: "active" },
  { id: "v-anfield", name: "Anfield", city: "Liverpool", country: "England", capacity: 61276, status: "active" },
  { id: "v-tottenham", name: "Tottenham Hotspur Stadium", city: "London", country: "England", capacity: 62850, status: "active" },
  { id: "v-bernabeu", name: "Santiago Bernabéu", city: "Madrid", country: "Spain", capacity: 83186, status: "active" },
  { id: "v-crypto", name: "Crypto.com Arena", city: "Los Angeles", country: "United States", capacity: 19079, status: "active" },
  { id: "v-chase", name: "Chase Center", city: "San Francisco", country: "United States", capacity: 18064, status: "active" },
  { id: "v-lolpark", name: "LoL Park, Seoul", city: "Seoul", country: "South Korea", capacity: 400, status: "active" },
  { id: "v-lecstudio", name: "LEC Studio, Berlin", city: "Berlin", country: "Germany", capacity: 300, status: "active" },
  { id: "v-uber", name: "Uber Arena, Berlin", city: "Berlin", country: "Germany", capacity: 17000, status: "active" },
  { id: "v-accor", name: "Accor Arena, Paris", city: "Paris", country: "France", capacity: 20300, status: "active" },
  { id: "v-centre-court", name: "Centre Court, Wimbledon", city: "London", country: "England", capacity: 14979, status: "active" },
  { id: "v-esl", name: "ESL Studios, Stockholm", city: "Stockholm", country: "Sweden", capacity: 200, status: "active" },
  { id: "v-oldtrafford", name: "Old Trafford", city: "Manchester", country: "England", capacity: 74310, status: "inactive" },
]

export function buildDataSources(clock: DemoClock): DataSource[] {
  const { fromNow } = evaluators(clock)
  return [
  { id: "ds-nba", name: "NBA Data API", sport: "basketball", status: "connected", lastSyncedAt: fromNow(-12) },
  { id: "ds-lck", name: "LCK Data API", sport: "lol", status: "connected", lastSyncedAt: fromNow(-25) },
  { id: "ds-epl", name: "Premier League Feed", sport: "football", status: "attention", lastSyncedAt: fromNow(-190) },
  { id: "ds-vct", name: "VCT Data API", sport: "valorant", status: "disconnected", lastSyncedAt: fromNow(-60 * 30) },
  { id: "ds-esl", name: "ESL Pro League Feed", sport: "cs2", status: "connected", lastSyncedAt: fromNow(-45) },
  { id: "ds-manual", name: "Manual Import", status: "connected", lastSyncedAt: fromNow(-60 * 26) },
  // Bound to the deterministic mock provider in lib/data/sync/providers/registry.ts.
  { id: "ds-mock-basketball", name: "Mock Basketball Feed", sport: "basketball", status: "connected" },
  // Bound to the Sportradar tennis adapter; needs SPORTRADAR_API_KEY to sync.
  { id: "ds-tennis-sportradar", name: "Sportradar Tennis", sport: "tennis", status: "connected" },
  ]
}

export function buildSyncLogs(clock: DemoClock): SyncLog[] {
  const { fromNow } = evaluators(clock)
  return [
  { id: "sl-01", dataSourceId: "ds-nba", entity: "matches", records: 12, status: "success", durationMs: 840, at: fromNow(-12) },
  { id: "sl-02", dataSourceId: "ds-lck", entity: "matches", records: 24, status: "success", durationMs: 1320, at: fromNow(-25) },
  { id: "sl-03", dataSourceId: "ds-esl", entity: "players", records: 60, status: "success", durationMs: 2100, at: fromNow(-45) },
  { id: "sl-04", dataSourceId: "ds-nba", entity: "teams", records: 30, status: "success", durationMs: 610, at: fromNow(-72) },
  { id: "sl-05", dataSourceId: "ds-epl", entity: "matches", records: 7, status: "partial", durationMs: 4900, at: fromNow(-190) },
  { id: "sl-06", dataSourceId: "ds-lck", entity: "players", records: 50, status: "success", durationMs: 1750, at: fromNow(-60 * 5) },
  { id: "sl-07", dataSourceId: "ds-epl", entity: "teams", records: 0, status: "failed", durationMs: 30000, at: fromNow(-60 * 7) },
  { id: "sl-08", dataSourceId: "ds-nba", entity: "players", records: 450, status: "success", durationMs: 6200, at: fromNow(-60 * 9) },
  { id: "sl-09", dataSourceId: "ds-lck", entity: "leagues", records: 1, status: "success", durationMs: 200, at: fromNow(-60 * 20) },
  { id: "sl-10", dataSourceId: "ds-manual", entity: "matches", records: 4, status: "success", durationMs: 90, at: fromNow(-60 * 26) },
  { id: "sl-11", dataSourceId: "ds-vct", entity: "matches", records: 0, status: "failed", durationMs: 30000, at: fromNow(-60 * 30) },
  { id: "sl-12", dataSourceId: "ds-esl", entity: "matches", records: 18, status: "success", durationMs: 980, at: fromNow(-60 * 33) },
  ]
}

export function buildAdminActivity(clock: DemoClock): AdminActivity[] {
  const { fromNow } = evaluators(clock)
  return [
  { id: "act-1", at: fromNow(-8), action: "Match updated", entity: "Arsenal vs Chelsea", actor: "Rose" },
  { id: "act-2", at: fromNow(-35), action: "Team added", entity: "Dplus KIA", actor: "Rose" },
  { id: "act-3", at: fromNow(-60 * 2), action: "Player updated", entity: "Faker", actor: "Sync · LCK Data API" },
  { id: "act-4", at: fromNow(-60 * 5), action: "League created", entity: "LCK", actor: "Rose" },
  { id: "act-5", at: fromNow(-60 * 9), action: "Season updated", entity: "NBA 2026-27", actor: "Sync · NBA Data API" },
  { id: "act-6", at: fromNow(-60 * 26), action: "Venue added", entity: "LoL Park, Seoul", actor: "Rose" },
  ]
}

export type DemoData = {
  matches: Match[]
  dataSources: DataSource[]
  syncLogs: SyncLog[]
  adminActivity: AdminActivity[]
}

/** Every time-relative part of the demo, laid over `clock`. The static catalogue and follows are the module exports above. */
export function buildDemoData(clock: DemoClock): DemoData {
  return {
    matches: buildMatches(clock),
    dataSources: buildDataSources(clock),
    syncLogs: buildSyncLogs(clock),
    adminActivity: buildAdminActivity(clock),
  }
}

/**
 * The module-level dataset for consumers that only need a representative
 * snapshot (admin activity, domain tests that read participants). Anchored
 * once at import to the real date, or to DEMO_ANCHOR when set. The seed does
 * not use these; it builds its own with the anchor it reports.
 */
const defaultClock = createDemoClock({
  anchor: resolveDemoAnchor(typeof process === "undefined" ? {} : process.env, new Date()),
})
const defaultData = buildDemoData(defaultClock)
export const matches: Match[] = defaultData.matches
export const dataSources: DataSource[] = defaultData.dataSources
export const syncLogs: SyncLog[] = defaultData.syncLogs
export const adminActivity: AdminActivity[] = defaultData.adminActivity
