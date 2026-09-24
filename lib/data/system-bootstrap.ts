import { dataSourceProviders, providers } from "@/lib/data/sync/providers/registry"
import type { Category, Sport } from "@/lib/data/types"
import { sportMeta, sports } from "@/lib/sports"

/**
 * The rows a freshly migrated database needs before the application and the
 * first provider sync can work: nothing else. Derived from code registries
 * so it can never drift from what the application already assumes.
 *
 * - `Sport`: every sport in lib/sports.ts. The navigation, the admin Sports
 *   page and every League row's foreign key assume these ids exist.
 * - `DataSource`: one row per provider binding in the sync registry. `runSync`
 *   looks the row up by id before it does anything, and the scheduler only
 *   considers rows that exist. Mock providers are excluded unless asked for,
 *   so Production never carries a fixture feed.
 *
 * Leagues, seasons, teams, players, venues and matches are NOT bootstrap
 * data: the first provider sync creates them. The demo seed (prisma/seed.ts)
 * is a separate, development-only fixture set and is never used for this.
 */

export type SystemSport = { id: Sport; category: Category; name: string; homeAway: boolean; sortOrder: number }

export type SystemDataSource = { id: string; name: string; sportId: string; kind: "live" | "mock" }

export function systemSports(): SystemSport[] {
  return sports.map((id, index) => ({ id, category: sportMeta[id].category, name: sportMeta[id].label, homeAway: sportMeta[id].homeAway, sortOrder: index }))
}

export function systemDataSources(options: { includeMock?: boolean } = {}): SystemDataSource[] {
  return Object.entries(dataSourceProviders)
    .map(([id, key]) => {
      const provider = providers[key]
      return provider ? { id, name: provider.name, sportId: provider.sport, kind: provider.kind } : null
    })
    .filter((row): row is SystemDataSource => row !== null && (options.includeMock === true || row.kind === "live"))
}

/** Every data source's sport must be a bootstrap sport, or the sync would fail on the foreign key. */
export function validateSystemBootstrap(): string[] {
  const sportIds = new Set(systemSports().map((sport) => sport.id as string))
  return systemDataSources({ includeMock: true })
    .filter((source) => !sportIds.has(source.sportId))
    .map((source) => `Data source ${source.id} needs sport "${source.sportId}", which is not in the sport registry.`)
}
