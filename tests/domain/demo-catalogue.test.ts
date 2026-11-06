import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"

import { SessionResolutionError, type Viewer } from "../../lib/auth/authorization"
import { resolveCatalogue, type CatalogueSource } from "../../lib/data/catalogue-source"
import { createDemoCatalogue } from "../../lib/data/demo-catalogue"
import { buildDemoMatches, buildDemoSeasons, demoLeagues, demoPlayers, demoTeams } from "../../lib/data/demo-fixtures"
import { checkDemoConsistency } from "../../lib/data/demo-consistency"
import { buildMatches, leagues as realLeagues, players as realPlayers, seasons as realSeasons, teams as realTeams, venues as realVenues } from "../../lib/data/mock"
import { createDemoClock } from "../../lib/demo-clock"
import { startOfDay } from "../../lib/format"

const anchor = new Date("2026-11-06T04:00:00.000Z")
const catalogue = createDemoCatalogue(createDemoClock({ anchor }))
const user: Viewer = { id: "u-1", email: "user@example.test", name: "User", role: "USER" }

/** Runtime imports of a source file: `import type` is erased and reaches nothing. */
function runtimeImports(file: string): string[] {
  const source = readFileSync(file, "utf8")
  return [...source.matchAll(/^(?:import|export) (?!type )[^;\n]*? from "([^"]+)"/gm)].map((match) => match[1])
}

function resolveModule(specifier: string, from: string): string | undefined {
  const base = specifier.startsWith("@/") ? specifier.slice(2) : specifier.startsWith(".") ? join(dirname(from), specifier) : undefined
  if (base === undefined) return undefined
  return [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find(existsSync)
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : []
  })
}

describe("catalogue selection", () => {
  const failing = new Proxy({}, { get: () => { throw new Error("the database catalogue was touched") } }) as CatalogueSource
  const neverBuilt = () => { throw new Error("demo built") }

  it("authenticated: the database catalogue, and the demo is not built", async () => {
    const live = {} as CatalogueSource
    assert.equal(await resolveCatalogue(async () => user, live, neverBuilt), live)
  })

  it("anonymous: the demo, and the database catalogue is never touched", async () => {
    assert.equal(await resolveCatalogue(async () => null, failing, () => catalogue), catalogue)
  })

  it("session check failed: rejects, and neither catalogue is used", async () => {
    await assert.rejects(resolveCatalogue(async () => { throw new SessionResolutionError() }, failing, neverBuilt), SessionResolutionError)
  })
})

describe("demo isolation", () => {
  it("the demo catalogue cannot reach the database, whatever it imports", () => {
    const seen = new Set<string>()
    const visit = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      for (const specifier of runtimeImports(file)) {
        assert.doesNotMatch(specifier, /prisma|lib\/data\/db|lib\/data\/repositories|lib\/auth\/session/, `${file} imports ${specifier}`)
        const resolved = resolveModule(specifier, file)
        if (resolved) visit(resolved)
      }
    }
    visit("lib/data/demo-catalogue.ts")
    assert.ok(seen.has("lib/data/mock.ts"), "the walk followed the imports")
  })

  it("the catalogue repositories are read only through the viewer-selected catalogue", () => {
    const queries = readFileSync("lib/data/queries.ts", "utf8")
    assert.doesNotMatch(queries, /\b(match|league|season|team|player)Repository\./)
    const catalogueRepository = /lib\/data\/repositories\/(match|league|season|team|player)-repository"/
    for (const file of [...sourceFiles("app"), ...sourceFiles("components")]) {
      assert.doesNotMatch(readFileSync(file, "utf8"), catalogueRepository, file)
    }
  })

  it("pages reach the database client directly only behind a session check", () => {
    // Route handlers under app/api authenticate their own callers (Better Auth, the cron secret).
    const direct = [...sourceFiles("app"), ...sourceFiles("components")].filter((file) => !file.startsWith("app/api/") && readFileSync(file, "utf8").includes('from "@/lib/data/db"'))
    assert.deepEqual(direct, ["app/(app)/watchlist/page.tsx"])
    assert.match(readFileSync(direct[0], "utf8"), /if \(!viewer\) redirect\(signInHref\("\/watchlist"\)\)/)
  })

  it("exposes reads only: no method can write", () => {
    for (const [group, methods] of Object.entries(catalogue)) {
      for (const method of Object.keys(methods)) assert.match(method, /^find/, `${group}.${method}`)
    }
  })

  it("carries no account data of any kind", async () => {
    const everything = JSON.stringify(await Promise.all([
      catalogue.matches.findViews(),
      catalogue.leagues.findMany(),
      catalogue.teams.findViews({}, anchor),
      catalogue.players.findViews(),
      catalogue.seasons.findByLeague("meridian-league"),
    ]))
    assert.doesNotMatch(everything, /@|password|session|token|"email"|"userId"|watchlist/i)
  })
})

describe("nothing caches across requests", () => {
  const sources = () => [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib").filter((file) => !file.startsWith("lib/generated/"))]

  it("no cross-request caching primitive is used, because the same URL serves different viewers", () => {
    for (const file of sources()) {
      assert.doesNotMatch(readFileSync(file, "utf8"), /unstable_cache|["']use cache|cacheLife|cacheTag|force-cache|force-static|export const revalidate|next:\s*\{\s*revalidate/, file)
    }
    assert.doesNotMatch(readFileSync("next.config.ts", "utf8"), /staleTimes|cacheComponents/)
  })

  it("React cache() appears only where it is scoped to one render", () => {
    const users = sources().filter((file) => /\bcache\(/.test(readFileSync(file, "utf8")) && /import \{[^}]*\bcache\b[^}]*\} from "react"/.test(readFileSync(file, "utf8")))
    assert.deepEqual(users.sort(), ["lib/auth/session.ts", "lib/data/queries.ts"])
  })

  it("sessions are checked against the database on every request", () => {
    assert.doesNotMatch(readFileSync("lib/auth/create-auth.ts", "utf8"), /cookieCache\s*:/)
  })
})

describe("demo reads behave like the repositories", () => {
  it("covers both categories and links every record it shows", async () => {
    const [matches, leagues, teams, players] = await Promise.all([catalogue.matches.findViews(), catalogue.leagues.findMany(), catalogue.teams.findMany(), catalogue.players.findViews()])
    assert.ok(new Set(leagues.map((league) => league.sport)).size >= 6)
    assert.ok(matches.length > 0 && teams.length > 0 && players.length > 0)
    for (const match of matches) {
      assert.equal((await catalogue.matches.findViewById(match.id))?.id, match.id)
      for (const participant of match.participants) {
        assert.ok(participant.team || participant.player, `${match.id} has an unresolved participant`)
      }
    }
    for (const player of players) assert.ok(player.league, `${player.id} has no league`)
    for (const status of ["live", "upcoming", "finished"] as const) assert.ok(matches.some((match) => match.status === status), status)
  })

  it("lists leagues in sport registry order, then by name", async () => {
    const sports = (await catalogue.leagues.findMany()).map((league) => league.sport)
    assert.equal(sports[0], "football")
    assert.equal(sports.at(-1), "cs2")
  })

  it("applies filters, ordering and limits", async () => {
    const { matches } = catalogue
    const finished = await matches.findViews({ status: "finished", order: "desc", limit: 3 })
    assert.equal(finished.length, 3)
    assert.ok(finished.every((match) => match.status === "finished"))
    assert.ok(finished[0].startsAt >= finished[2].startsAt)

    assert.deepEqual(await matches.findViews({ ids: [] }), [])
    assert.deepEqual(await matches.findViews({ followed: { teamIds: [], playerIds: [], leagueIds: [] } }), [], "empty follows match nothing")

    const arsenal = await matches.findViews({ teamIds: ["redbrook-rovers"] })
    assert.ok(arsenal.length > 0 && arsenal.every((match) => match.participants.some((p) => p.teamId === "redbrook-rovers")))
    assert.ok((await matches.findViews({ playerIds: ["mateo-ribera"] })).length > 0, "individual athletes")

    const epl = await matches.findViews({ leagueId: "meridian-league", excludeId: arsenal[0].id })
    assert.ok(epl.every((match) => match.leagueId === "meridian-league" && match.id !== arsenal[0].id))

    const later = await matches.findViews({ startsAt: { gt: anchor } })
    assert.ok(later.every((match) => Date.parse(match.startsAt) > anchor.getTime()))
  })

  it("gives a team its next match and an unknown id nothing", async () => {
    const team = await catalogue.teams.findViewById("redbrook-rovers", anchor)
    assert.equal(team?.league.id, "meridian-league")
    assert.ok(team?.nextMatch && team.nextMatch.status !== "finished")
    assert.equal(await catalogue.teams.findViewById("nope"), undefined)
    assert.equal(await catalogue.matches.findViewById("nope"), undefined)
    assert.equal(await catalogue.players.findViewById("nope"), undefined)
    assert.equal(await catalogue.leagues.findById("nope"), undefined)
  })

  it("sorting a read never reorders the data shared between requests", async () => {
    const before = JSON.stringify([demoLeagues, demoTeams, demoPlayers])
    await Promise.all([catalogue.leagues.findMany(), catalogue.teams.findMany(), catalogue.teams.findViews({}, anchor), catalogue.players.findViews(), catalogue.players.findByTeam("redbrook-rovers"), catalogue.seasons.findByLeague("meridian-league")])
    assert.equal(JSON.stringify([demoLeagues, demoTeams, demoPlayers]), before)
  })

  it("never ages: at every half hour of a day the timeline is coherent and today is populated", async () => {
    for (let step = 0; step < 48; step += 1) {
      const at = new Date(anchor.getTime() + step * 30 * 60_000)
      const clock = createDemoClock({ anchor: at })
      const source = createDemoCatalogue(clock)
      const matches = await source.matches.findViews()
      assert.deepEqual(checkDemoConsistency({ matches, follows: { watchlistMatchIds: [], watchlistReminders: {} } }, clock), [], at.toISOString())
      const from = startOfDay(at)
      const today = await source.matches.findViews({ startsAt: { gte: from, lt: new Date(from.getTime() + 86_400_000) } })
      assert.ok(today.length > 0, `nothing today at ${at.toISOString()}`)
    }
  })
})

describe("the public demo names nothing real", () => {
  it("no real league, team, athlete or venue survives in anything a visitor can read", async () => {
    const shown = JSON.stringify(await Promise.all([
      catalogue.matches.findViews(),
      catalogue.leagues.findMany(),
      catalogue.teams.findViews({}, anchor),
      catalogue.players.findViews(),
      ...demoLeagues.map((league) => catalogue.seasons.findByLeague(league.id)),
    ]))
    const real = [
      ...realLeagues.flatMap((league) => [league.name, league.shortName]),
      ...realTeams.flatMap((team) => [team.name, team.shortName, team.code]),
      ...realPlayers.flatMap((player) => [player.name, ...player.name.split(" ").filter((part) => part.length > 3), player.handle ?? ""]),
      ...realVenues.map((venue) => venue.name),
      ...buildMatches(createDemoClock({ anchor })).flatMap((match) => [match.id, match.venue ?? ""]),
      "Wimbledon", "Gentlemen", "Ladies", "Champions",
    ].filter((name) => name.length > 0)
    for (const name of new Set(real)) {
      assert.doesNotMatch(shown, new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`), `"${name}" appears in the demo`)
    }
  })

  it("no real id survives either, so a URL cannot name a real record", async () => {
    const ids = new Set([...demoLeagues, ...demoTeams, ...demoPlayers].map((record) => record.id))
    for (const record of [...realLeagues, ...realTeams, ...realPlayers]) assert.ok(!ids.has(record.id), record.id)
    assert.equal(await catalogue.teams.findViewById("arsenal"), undefined)
    assert.equal(await catalogue.players.findViewById("saka"), undefined)
    assert.equal(await catalogue.leagues.findById("epl"), undefined)
  })

  it("fictional identities are unique", () => {
    for (const records of [demoLeagues, demoTeams, demoPlayers]) {
      assert.equal(new Set(records.map((record) => record.id)).size, records.length)
      assert.equal(new Set(records.map((record) => record.name)).size, records.length)
    }
    assert.equal(new Set(demoTeams.map((team) => team.code)).size, demoTeams.length)
  })
})

describe("no demo record is a renamed real one", () => {
  // The fixtures are mapped one to one and in order, so an index pairs each fictional record with its source.
  const rgb = (hex: string) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16))
  const distance = (a: string, b: string) => Math.hypot(...rgb(a).map((channel, index) => channel - rgb(b)[index]))
  const profile = (player: { role: string; nationality?: string; number?: number }) => [player.role, player.nationality, player.number].join("|")

  /** Identities outside mock.ts that would still be recognised, as [primary, secondary]. */
  const REAL_CLUB_PALETTES = [
    ["#EF0107", "#FFFFFF"], // Arsenal
    ["#C8102E", "#00B2A9"], // Liverpool
    ["#6CABDD", "#1C2C5B"], // Manchester City
    ["#034694", "#DBA111"], // Chelsea
    ["#132257", "#FFFFFF"], // Tottenham
    ["#FEBE10", "#00529F"], // Real Madrid
    ["#DC052D", "#0066B2"], // Bayern
    ["#552583", "#FDB927"], // Lakers
    ["#007A33", "#BA9653"], // Celtics
    ["#1D428A", "#FFC72C"], // Warriors
    ["#0E2240", "#FEC524"], // Nuggets
  ]

  it("every player differs from its source in role, nationality and number", () => {
    assert.equal(demoPlayers.length, realPlayers.length)
    demoPlayers.forEach((player, index) => {
      const source = realPlayers[index]
      assert.notEqual(player.role, source.role, `${player.name}: role`)
      assert.notEqual(player.nationality, source.nationality, `${player.name}: nationality`)
      if (source.number !== undefined) assert.notEqual(player.number, source.number, `${player.name}: number`)
      assert.equal(player.number === undefined, source.number === undefined, `${player.name}: only team sports carry a number`)
    })
  })

  it("no player's combined profile matches any real player's, not only its own source", () => {
    const real = new Set(realPlayers.map(profile))
    for (const player of demoPlayers) assert.ok(!real.has(profile(player)), `${player.name}: ${profile(player)}`)
    assert.equal(new Set(demoPlayers.map(profile)).size, demoPlayers.length, "every profile is distinct")
  })

  it("the most recognisable real profiles are gone", () => {
    const known = [["Forward", "United States", 23], ["Center", "Serbia", 15], ["Point guard", "United States", 30], ["Striker", "Norway", 9], ["Right winger", "Egypt", 11], ["Striker", "England", 9]]
    for (const [role, nationality, number] of known) {
      assert.ok(!demoPlayers.some((player) => player.role === role && player.nationality === nationality && player.number === number), `${role}, ${nationality}, #${number}`)
    }
    assert.ok(!demoPlayers.some((player) => player.role === "Mid" && player.nationality === "South Korea"), "a Korean mid")
    assert.ok(!demoPlayers.some((player) => player.role === "Duelist" && player.nationality === "Canada"), "a Canadian duelist")
    assert.ok(!demoPlayers.some((player) => player.role === "AWPer" && player.nationality === "France"), "a French AWPer")
  })

  it("no team colour is close to any real team's, and each team has a palette of its own", () => {
    for (const team of demoTeams) {
      assert.ok(team.secondaryColor, `${team.name} has no secondary colour`)
      for (const real of realTeams) assert.ok(distance(team.color, real.color) >= 45, `${team.name} ${team.color} is close to ${real.name} ${real.color}`)
      assert.ok(distance(team.color, team.secondaryColor) >= 110, `${team.name}: its two colours are too alike to tell apart`)
    }
    demoTeams.forEach((team, index) => {
      for (const other of demoTeams.slice(index + 1)) assert.ok(distance(team.color, other.color) >= 30, `${team.name} and ${other.name} look alike`)
    })
    assert.equal(new Set(demoTeams.map((team) => team.secondaryColor)).size, demoTeams.length, "secondary colours are distinct")
  })

  it("no palette resembles a real club's colour pair", () => {
    for (const team of demoTeams) {
      for (const [primary, secondary] of REAL_CLUB_PALETTES) {
        const alike = distance(team.color, primary) < 90 && distance(team.secondaryColor ?? "#000000", secondary) < 90
        assert.ok(!alike, `${team.name} resembles ${primary} and ${secondary}`)
      }
    }
  })

  it("no real team colour reaches a visitor", async () => {
    const shown = JSON.stringify(await Promise.all([catalogue.teams.findViews({}, anchor), catalogue.matches.findViews()]))
    for (const real of realTeams) assert.ok(!shown.includes(real.color), real.color)
  })

  it("the three replaced names are gone", () => {
    const names = JSON.stringify([demoTeams, demoPlayers])
    assert.doesNotMatch(names, /Kalni|Hanseo|Jinmyeong/i)
  })
})

describe("demo dates follow no real calendar", () => {
  const DAY = 86_400_000
  /** A sweep of a whole year, so the rules hold on whichever date someone opens the demo. */
  const anchors = Array.from({ length: 366 }, (_, day) => new Date(anchor.getTime() + day * DAY))
  const length = (season: { startsAt: string; endsAt: string }) => (Date.parse(season.endsAt) - Date.parse(season.startsAt)) / DAY
  const monthDay = (date: string) => Date.parse(`2000-${date.slice(5)}`)
  const closeInYear = (a: string, b: string, days: number) => {
    const gap = Math.abs(monthDay(a) - monthDay(b)) / DAY
    return Math.min(gap, 366 - gap) <= days
  }

  it("no season has the length of a real one, so its dates can never line up with one", () => {
    const seasons = buildDemoSeasons(createDemoClock({ anchor }))
    assert.equal(seasons.length, realSeasons.length)
    for (const season of seasons) {
      for (const real of realSeasons) assert.ok(Math.abs(length(season) - length(real)) > 6, `${season.name} (${length(season)} days) is the length of ${real.name} (${length(real)} days)`)
    }
  })

  it("on no date of the year does a season share its start and end with a real one", () => {
    for (const at of anchors) {
      for (const season of buildDemoSeasons(createDemoClock({ anchor: at }))) {
        for (const real of realSeasons) {
          assert.ok(!(closeInYear(season.startsAt, real.startsAt, 3) && closeInYear(season.endsAt, real.endsAt, 3)), `${season.name} ${season.startsAt} to ${season.endsAt} matches ${real.name}`)
        }
      }
    }
  })

  it("Hollow Oak Open no longer runs on Wimbledon's dates or for its fortnight", () => {
    for (const at of anchors) {
      const open = buildDemoSeasons(createDemoClock({ anchor: at })).find((season) => season.leagueId === "hollow-oak-open")
      assert.ok(open)
      assert.ok(length(open) > 20, "longer than a two-week major")
      assert.ok(!(open.startsAt.endsWith("-06-29") && open.endsAt.endsWith("-07-12")))
    }
  })

  it("season labels carry no real year or real competition edition", () => {
    const labels = [...buildDemoSeasons(createDemoClock({ anchor })).map((season) => season.name), ...demoLeagues.map((league) => league.season)]
    for (const label of labels) assert.doesNotMatch(label, /20\d\d|Summer|Champions|Season 22/, label)
  })

  it("on every date, each league has one current season, which contains all its matches and carries its label", () => {
    for (const at of anchors) {
      const clock = createDemoClock({ anchor: at })
      const seasons = buildDemoSeasons(clock)
      const matches = buildDemoMatches(clock)
      const today = seasons.find((season) => season.status === "current")?.startsAt
      assert.ok(today)
      for (const league of demoLeagues) {
        const own = seasons.filter((season) => season.leagueId === league.id)
        const current = own.filter((season) => season.status === "current")
        assert.equal(current.length, 1, league.name)
        assert.equal(current[0].name, league.season, `${league.name}: the label names the current season`)
        for (const match of matches.filter((candidate) => candidate.leagueId === league.id)) {
          assert.equal(match.seasonId, current[0].id, match.id)
          const day = Date.parse(match.startsAt)
          assert.ok(day >= Date.parse(current[0].startsAt) && day <= Date.parse(current[0].endsAt) + DAY, `${match.id} is outside ${current[0].name} at ${at.toISOString()}`)
        }
      }
    }
  })

  it("on every date, statuses agree with the dates and seasons run in order without overlapping", () => {
    for (const at of anchors) {
      const seasons = buildDemoSeasons(createDemoClock({ anchor: at }))
      for (const season of seasons) {
        assert.ok(season.startsAt < season.endsAt, season.name)
        const start = Date.parse(season.startsAt)
        const end = Date.parse(season.endsAt)
        if (season.status === "current") assert.ok(start <= at.getTime() && at.getTime() <= end + DAY, season.name)
        if (season.status === "completed") assert.ok(end < at.getTime(), season.name)
        if (season.status === "upcoming") assert.ok(start > at.getTime(), season.name)
      }
      for (const league of demoLeagues) {
        const own = seasons.filter((season) => season.leagueId === league.id).sort((a, b) => a.startsAt.localeCompare(b.startsAt))
        own.slice(1).forEach((season, index) => assert.ok(own[index].endsAt < season.startsAt, `${league.name} overlaps`))
      }
    }
  })

  it("the match timeline holds no fixed date, only offsets from today", () => {
    const earlier = buildDemoMatches(createDemoClock({ anchor }))
    const later = buildDemoMatches(createDemoClock({ anchor: new Date(anchor.getTime() + 100 * DAY) }))
    earlier.forEach((match, index) => assert.equal(Date.parse(later[index].startsAt) - Date.parse(match.startsAt), 100 * DAY, match.id))
    assert.doesNotMatch(readFileSync("lib/data/demo-fixtures.ts", "utf8"), /["']20\d\d-\d\d-\d\d/)
  })
})
