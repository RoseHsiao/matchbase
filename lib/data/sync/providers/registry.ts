import { mockBasketballProvider } from "@/lib/data/sync/providers/mock-basketball"
import type { Provider } from "@/lib/data/sync/types"

/**
 * Every provider adapter the application knows, keyed by `Provider.key`.
 * Adding a feed is one entry here plus one adapter file.
 */
export const providers: Record<string, Provider<never>> = {
  [mockBasketballProvider.key]: mockBasketballProvider as Provider<never>,
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
}

export function resolveProvider(dataSourceId: string): Provider<never> | undefined {
  const key = dataSourceProviders[dataSourceId]
  return key ? providers[key] : undefined
}
