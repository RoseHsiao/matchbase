import { mockBasketballProvider } from "@/lib/data/sync/providers/mock-basketball"
import { sportradarTennisProvider } from "@/lib/data/sync/providers/sportradar-tennis"
import { theSportsDbPremierLeagueProvider } from "@/lib/data/sync/providers/thesportsdb"
import type { Provider, ProviderConfigurationStatus } from "@/lib/data/sync/types"

/**
 * Every provider adapter the application knows, keyed by `Provider.key`.
 * Adding a feed is one entry here plus one adapter file.
 */
export const providers: Record<string, Provider<never>> = {
  [mockBasketballProvider.key]: mockBasketballProvider as Provider<never>,
  [sportradarTennisProvider.key]: sportradarTennisProvider as Provider<never>,
  [theSportsDbPremierLeagueProvider.key]: theSportsDbPremierLeagueProvider as Provider<never>,
}

/**
 * Which adapter serves which DataSource row.
 *
 * The DataSource model has no provider column yet (deferred: it needs a
 * migration), so the binding lives here. Seeded sources without an entry
 * cannot be synced and report "no provider registered".
 */
export const dataSourceProviders: Record<string, string> = {
  "ds-mock-basketball": mockBasketballProvider.key,
  "ds-tennis-sportradar": sportradarTennisProvider.key,
  "ds-thesportsdb-epl": theSportsDbPremierLeagueProvider.key,
}

export function resolveProvider(dataSourceId: string): Provider<never> | undefined {
  const key = dataSourceProviders[dataSourceId]
  return key ? providers[key] : undefined
}

/** What the admin UI shows about a DataSource's binding: which adapter, mock or live, and whether it is configured. */
export type DataSourceProviderInfo = {
  key: string
  name: string
  kind: Provider["kind"]
  sport: string
  configuration: ProviderConfigurationStatus
}

export function describeDataSourceProvider(dataSourceId: string): DataSourceProviderInfo | undefined {
  const provider = resolveProvider(dataSourceId)
  if (!provider) return undefined
  return {
    key: provider.key,
    name: provider.name,
    kind: provider.kind,
    sport: provider.sport,
    configuration: provider.checkConfiguration ? provider.checkConfiguration() : { configured: true },
  }
}
