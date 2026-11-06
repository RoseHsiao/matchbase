import type { Viewer } from "@/lib/auth/authorization"
import type { MatchQuery } from "@/lib/data/repositories/match-repository"
import type { League, MatchView, Player, PlayerView, Season, Team, TeamView } from "@/lib/data/types"

/**
 * The catalogue reads the application-facing queries depend on. Two
 * implementations exist: the Prisma repositories (lib/data/repositories) and
 * the in-memory public demo (lib/data/demo-catalogue.ts).
 */
export type CatalogueSource = {
  matches: {
    findViews(query?: MatchQuery): Promise<MatchView[]>
    findViewById(id: string): Promise<MatchView | undefined>
  }
  leagues: {
    findMany(): Promise<League[]>
    findById(id: string): Promise<League | undefined>
    findByIds(ids: readonly string[]): Promise<League[]>
  }
  seasons: {
    findByLeague(leagueId: string): Promise<Season[]>
  }
  teams: {
    findMany(): Promise<Team[]>
    findViews(filter?: { leagueId?: string }, now?: Date): Promise<TeamView[]>
    findViewById(id: string, now?: Date): Promise<TeamView | undefined>
  }
  players: {
    findViews(): Promise<PlayerView[]>
    findViewById(id: string): Promise<PlayerView | undefined>
    findByTeam(teamId: string): Promise<Player[]>
  }
}

/**
 * The public demo boundary, over the three outcomes of resolveViewer: a viewer
 * reads the database catalogue, a genuinely anonymous visitor (null) reads the
 * demo, and a failed session check rejects, so it reaches the error boundary
 * and never falls back to the demo. The demo is built lazily so a signed-in
 * request never pays for it.
 */
export async function resolveCatalogue(viewer: () => Promise<Viewer | null>, live: CatalogueSource, demo: () => CatalogueSource): Promise<CatalogueSource> {
  return (await viewer()) === null ? demo() : live
}
