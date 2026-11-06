import { buildMatches, leagues, players, seasons, teams } from "@/lib/data/mock"
import type { League, Match, Player, Season, Team } from "@/lib/data/types"
import type { DemoClock } from "@/lib/demo-clock"
import { addCalendarDays } from "@/lib/time-zone"

/**
 * The public demo's cast: lib/data/mock.ts with every league, team, athlete
 * and venue replaced by an invented one, profile and colours included, because a
 * renamed Serbian center wearing #15 is still recognisable. The results in that timeline are made
 * up, so they must never appear beside a real name in public: a score for a
 * real club or a final between real athletes reads as a claim that it happened.
 * The seed keeps mock.ts as it is, for development databases, and Production
 * is never seeded.
 *
 * Seasons are laid over the same clock as the matches, as day offsets from
 * today, so a "current" season always contains its matches and no calendar can
 * line up with a real competition's. Their lengths differ from every real season
 * in mock.ts by more than a week, so that holds on any date.
 *
 * The timeline itself (timing, statuses, scores) is reused unchanged. A record
 * with no entry below throws, so a fixture added to mock.ts cannot reach the
 * demo under its real name. Sports and games keep their real names: they are
 * categories, and no result is attributed to them.
 */

type LeagueIdentity = Pick<League, "id" | "name" | "shortName" | "region" | "season">
type TeamIdentity = Pick<Team, "id" | "name" | "shortName" | "code" | "color" | "secondaryColor">
type PlayerIdentity = Pick<Player, "id" | "name" | "handle" | "role" | "nationality" | "number">

const LEAGUES: Record<string, LeagueIdentity> = {
  epl: { id: "meridian-league", name: "Meridian Football League", shortName: "MFL", region: "Northern Region", season: "Season 31" },
  ucl: { id: "continental-cup", name: "Continental Club Cup", shortName: "CCC", region: "Continental", season: "Season 9" },
  nba: { id: "coastline-league", name: "Coastline Basketball League", shortName: "CBL", region: "Coastal", season: "Season 17" },
  lec: { id: "aurora-rift", name: "Aurora Rift League", shortName: "ARL", region: "Western Circuit", season: "Season 5" },
  lck: { id: "sunrise-rift", name: "Sunrise Rift League", shortName: "SRL", region: "Eastern Circuit", season: "Season 11" },
  vct: { id: "apex-spike", name: "Apex Spike Invitational", shortName: "ASI", region: "International", season: "Finals 6" },
  esl: { id: "frontline-circuit", name: "Frontline Pro Circuit", shortName: "FPC", region: "International", season: "Season 3" },
  wimbledon: { id: "hollow-oak-open", name: "Hollow Oak Open", shortName: "Hollow Oak", region: "Northern Region", season: "Edition 14" },
}

const TEAMS: Record<string, TeamIdentity> = {
  arsenal: { id: "redbrook-rovers", name: "Redbrook Rovers", shortName: "Redbrook", code: "RBR", color: "#8C4A2F", secondaryColor: "#E8D5B7" },
  liverpool: { id: "kestrel-bay", name: "Kestrel Bay FC", shortName: "Kestrel Bay", code: "KBY", color: "#3E7C8C", secondaryColor: "#F4E285" },
  "man-city": { id: "ironvale", name: "Ironvale Athletic", shortName: "Ironvale", code: "IVA", color: "#4A5568", secondaryColor: "#D9C29C" },
  chelsea: { id: "silverford", name: "Silverford Town", shortName: "Silverford", code: "SFT", color: "#A0AEC0", secondaryColor: "#6B4E16" },
  tottenham: { id: "marlowe-albion", name: "Marlowe Albion", shortName: "Marlowe", code: "MAL", color: "#6B2D5C", secondaryColor: "#7DD3FC" },
  "real-madrid": { id: "castelvar", name: "Castelvar CF", shortName: "Castelvar", code: "CVR", color: "#D9CAB3", secondaryColor: "#7A3E1D" },
  bayern: { id: "stahlbruck", name: "SV Stahlbruck", shortName: "Stahlbruck", code: "STB", color: "#5C6B2F", secondaryColor: "#E6E1A1" },
  lakers: { id: "bayline-comets", name: "Bayline Comets", shortName: "Comets", code: "BAY", color: "#B0447A", secondaryColor: "#FFE8D6" },
  celtics: { id: "pinecrest-herons", name: "Pinecrest Herons", shortName: "Herons", code: "PCH", color: "#3B5D3A", secondaryColor: "#C9D6A3" },
  warriors: { id: "harbor-city-tide", name: "Harbor City Tide", shortName: "Tide", code: "HCT", color: "#2F78A8", secondaryColor: "#FFD6A5" },
  nuggets: { id: "summit-ridge-elk", name: "Summit Ridge Elk", shortName: "Elk", code: "SRE", color: "#86546F", secondaryColor: "#F3D9B1" },
  g2: { id: "vantablue", name: "Vantablue Esports", shortName: "Vantablue", code: "VBL", color: "#5B5BD6", secondaryColor: "#FDE68A" },
  fnatic: { id: "emberfall", name: "Emberfall", shortName: "Emberfall", code: "EMB", color: "#B5532A", secondaryColor: "#2B2118" },
  kc: { id: "corvane", name: "Corvane Gaming", shortName: "Corvane", code: "CVN", color: "#37474F", secondaryColor: "#80CBC4" },
  mad: { id: "quillon-five", name: "Quillon Five", shortName: "Quillon", code: "QLN", color: "#B8A1D9", secondaryColor: "#5B2C06" },
  t1: { id: "glasswing-one", name: "Glasswing One", shortName: "Glasswing", code: "GW1", color: "#7FD1C7", secondaryColor: "#7A3E8F" },
  geng: { id: "starfen", name: "Starfen Esports", shortName: "Starfen", code: "SFN", color: "#E7A0B8", secondaryColor: "#4A1D3A" },
  hle: { id: "taeryong", name: "Taeryong Esports", shortName: "Taeryong", code: "TRY", color: "#A83E4A", secondaryColor: "#F4DCC6" },
  dk: { id: "solgae", name: "Solgae Gaming", shortName: "Solgae", code: "SLG", color: "#A3B18A", secondaryColor: "#344E41" },
  sentinels: { id: "night-wardens", name: "Night Wardens", shortName: "Wardens", code: "NWD", color: "#6D6A9C", secondaryColor: "#E2E8F0" },
  fut: { id: "kismet", name: "Kismet Esports", shortName: "Kismet", code: "KSM", color: "#C2410C", secondaryColor: "#1E3A2F" },
  prx: { id: "origami-tigers", name: "Origami Tigers", shortName: "Origami", code: "ORG", color: "#F4C27A", secondaryColor: "#5A2A27" },
  loud: { id: "clamor", name: "Clamor", shortName: "Clamor", code: "CLM", color: "#84CC16", secondaryColor: "#1A2E05" },
  navi: { id: "polaris-nine", name: "Polaris Nine", shortName: "Polaris", code: "PN9", color: "#BFD7EA", secondaryColor: "#1B3A57" },
  vitality: { id: "team-verdant", name: "Team Verdant", shortName: "Verdant", code: "VRD", color: "#3A7D4F", secondaryColor: "#F2E8CF" },
  faze: { id: "halcyon-clan", name: "Halcyon Clan", shortName: "Halcyon", code: "HLC", color: "#D4A5FF", secondaryColor: "#2E1065" },
  spirit: { id: "wraithline", name: "Wraithline", shortName: "Wraithline", code: "WRL", color: "#78716C", secondaryColor: "#FAFAF9" },
}

const PLAYERS: Record<string, PlayerIdentity> = {
  saka: { id: "theo-ashgrove", name: "Theo Ashgrove", role: "Goalkeeper", nationality: "Ireland", number: 1 },
  odegaard: { id: "lars-vindal", name: "Lars Vindal", role: "Centre-back", nationality: "Iceland", number: 4 },
  salah: { id: "karim-nassour", name: "Karim Nassour", role: "Left-back", nationality: "Tunisia", number: 3 },
  palmer: { id: "owen-thackeray", name: "Owen Thackeray", role: "Defensive midfielder", nationality: "Wales", number: 6 },
  haaland: { id: "sindre-holmvik", name: "Sindre Holmvik", role: "Right-back", nationality: "Finland", number: 22 },
  bellingham: { id: "marcus-delacourt", name: "Marcus Delacourt", role: "Right winger", nationality: "Luxembourg", number: 14 },
  kane: { id: "rory-pemberton", name: "Rory Pemberton", role: "Centre-back", nationality: "Scotland", number: 15 },
  tatum: { id: "dorian-whitlock", name: "Dorian Whitlock", role: "Center", nationality: "Canada", number: 44 },
  curry: { id: "miles-oakhurst", name: "Miles Oakhurst", role: "Power forward", nationality: "Australia", number: 12 },
  lebron: { id: "andre-falconer", name: "Andre Falconer", role: "Shooting guard", nationality: "France", number: 8 },
  jokic: { id: "dusan-vrankov", name: "Dušan Vrankov", role: "Point guard", nationality: "Croatia", number: 21 },
  caps: { id: "brightline", name: "Anders Lykke", handle: "Brightline", role: "Support", nationality: "Netherlands" },
  razork: { id: "thornwood", name: "Pablo Serrat", handle: "Thornwood", role: "Top", nationality: "Portugal" },
  targamas: { id: "warden", name: "Luc Maertens", handle: "Warden", role: "Bot", nationality: "Switzerland" },
  faker: { id: "moonrise", name: "Han Do-yun", handle: "Moonrise", role: "Jungle", nationality: "Canada" },
  chovy: { id: "quickstep", name: "Baek Si-woo", handle: "Quickstep", role: "Top", nationality: "Australia" },
  zeka: { id: "paperkite", name: "Yoon Tae-oh", handle: "Paperkite", role: "Support", nationality: "United States" },
  showmaker: { id: "lantern", name: "Noh Eun-seo", handle: "Lantern", role: "Bot", nationality: "New Zealand" },
  tenz: { id: "fastfuse", name: "Evan Tremblay", handle: "FastFuse", role: "Controller", nationality: "Ireland" },
  f0rsaken: { id: "tidewake", name: "Rizal Wibowo", handle: "Tidewake", role: "Sentinel", nationality: "Malaysia" },
  zywoo: { id: "longglass", name: "Bastien Morvan", handle: "LongGlass", role: "In-game leader", nationality: "Switzerland" },
  donk: { id: "sparrowhawk", name: "Ilya Sorokov", handle: "Sparrowhawk", role: "Support", nationality: "Kazakhstan" },
  ropz: { id: "northwind", name: "Kaspar Lepik", handle: "Northwind", role: "AWPer", nationality: "Latvia" },
  alcaraz: { id: "mateo-ribera", name: "Mateo Ribera", role: "Serve-and-volley singles", nationality: "Argentina" },
  sinner: { id: "luca-brandolin", name: "Luca Brandolin", role: "Counterpuncher singles", nationality: "Uruguay" },
  hsieh: { id: "lin-pei-chen", name: "Lin Pei-chen", role: "Net specialist doubles", nationality: "Singapore" },
  ostapenko: { id: "odalys-brightwater", name: "Odalys Brightwater", role: "Baseline doubles", nationality: "Chile" },
  siniakova: { id: "petra-novakova", name: "Petra Nováková-Dvorak", role: "Serve-first doubles", nationality: "Slovakia" },
  townsend: { id: "jordan-ellery", name: "Jordan Ellery", role: "All-court doubles", nationality: "Jamaica" },
}

const VENUES: Record<string, string> = {
  "LEC Studio, Berlin": "Aurora Studio",
  "ESL Studios, Stockholm": "Frontline Studio",
  "Emirates Stadium": "Redbrook Park",
  "Accor Arena, Paris": "Apex Arena",
  Anfield: "Kestrel Road",
  "Crypto.com Arena": "Bayline Arena",
  "Santiago Bernabéu": "Estadio Castelvar",
  "Chase Center": "Harbor City Center",
  "Tottenham Hotspur Stadium": "Marlowe Ground",
  "Uber Arena, Berlin": "Aurora Dome",
  "LoL Park, Seoul": "Sunrise Hall",
  "Centre Court, Wimbledon": "Hollow Oak Centre Court",
}

/** Days from today, by source season id. A season's length is `toDay - fromDay`. */
const SEASONS: Record<string, { name: string; fromDay: number; toDay: number }> = {
  "s-epl-2627": { name: "Season 31", fromDay: -130, toDay: 170 },
  "s-epl-2526": { name: "Season 30", fromDay: -500, toDay: -200 },
  "s-ucl-2627": { name: "Season 9", fromDay: -60, toDay: 150 },
  "s-nba-2627": { name: "Season 17", fromDay: -45, toDay: 150 },
  "s-nba-2526": { name: "Season 16", fromDay: -260, toDay: -70 },
  "s-lec-summer26": { name: "Season 5", fromDay: -50, toDay: 70 },
  "s-lck-2026": { name: "Season 11", fromDay: -90, toDay: 130 },
  "s-lck-2027": { name: "Season 12", fromDay: 170, toDay: 390 },
  "s-vct-champ26": { name: "Finals 6", fromDay: -20, toDay: 20 },
  "s-esl-22": { name: "Season 3", fromDay: -35, toDay: 35 },
  "s-wim-2026": { name: "Edition 14", fromDay: -11, toDay: 24 },
}

const STAGES: Record<string, string> = {
  "Gentlemen's singles · Final": "Men's singles · Final",
  "Ladies' doubles · Final": "Women's doubles · Final",
}

function identity<T>(table: Record<string, T>, id: string, kind: string): T {
  if (!Object.hasOwn(table, id)) throw new Error(`The demo has no fictional identity for ${kind} "${id}" (lib/data/demo-fixtures.ts).`)
  return table[id]
}

export const demoLeagues: League[] = leagues.map((league) => ({ ...league, ...identity(LEAGUES, league.id, "league") }))

export const demoTeams: Team[] = teams.map((team) => ({
  ...team,
  ...identity(TEAMS, team.id, "team"),
  leagueId: identity(LEAGUES, team.leagueId, "league").id,
}))

export const demoPlayers: Player[] = players.map((player) => ({
  ...player,
  ...identity(PLAYERS, player.id, "player"),
  teamId: player.teamId === undefined ? undefined : identity(TEAMS, player.teamId, "team").id,
}))

export function buildDemoSeasons(clock: DemoClock): Season[] {
  const dayFromToday = (offset: number) => {
    const { year, month, day } = addCalendarDays(clock.anchorDate(), offset)
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  }
  return seasons.map((season, index) => {
    const { name, fromDay, toDay } = identity(SEASONS, season.id, "season")
    return {
      ...season,
      id: `demo-season-${index + 1}`,
      leagueId: identity(LEAGUES, season.leagueId, "league").id,
      name,
      startsAt: dayFromToday(fromDay),
      endsAt: dayFromToday(toDay),
    }
  })
}

/** The authored timeline under the fictional cast. Ids are derived from position, so none carries a real name. */
export function buildDemoMatches(clock: DemoClock): Match[] {
  const currentSeason = new Map(buildDemoSeasons(clock).filter((season) => season.status === "current").map((season) => [season.leagueId, season.id]))
  return buildMatches(clock).map((match, index) => {
    const id = `demo-match-${index + 1}`
    const leagueId = identity(LEAGUES, match.leagueId, "league").id
    return {
      ...match,
      id,
      leagueId,
      seasonId: currentSeason.get(leagueId),
      stage: match.stage === undefined ? undefined : (STAGES[match.stage] ?? match.stage),
      venue: match.venue === undefined ? undefined : identity(VENUES, match.venue, "venue"),
      participants: match.participants.map((participant) => ({
        ...participant,
        id: `${id}-${participant.side}${participant.order}`,
        teamId: participant.teamId === undefined ? undefined : identity(TEAMS, participant.teamId, "team").id,
        playerId: participant.playerId === undefined ? undefined : identity(PLAYERS, participant.playerId, "player").id,
      })),
    }
  })
}
