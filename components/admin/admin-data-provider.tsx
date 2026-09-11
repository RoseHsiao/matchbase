"use client"

import * as React from "react"

import { createCollectionStore, type CollectionStore } from "@/lib/collection-store"
import type { AdminData } from "@/lib/data/types"

type AdminStores = {
  [K in keyof AdminData]: CollectionStore<AdminData[K][number]>
}

type AdminContextValue = {
  stores: AdminStores
  /** Server reference time as ISO, so relative labels agree on both sides. */
  now: string
}

const AdminContext = React.createContext<AdminContextValue | null>(null)

type AdminDataProviderProps = {
  initial: AdminData
  now: string
  children: React.ReactNode
}

/**
 * Holds every admin collection in client state for the session, seeded once
 * from the server mock. Edits are local until a persistence layer exists.
 */
export function AdminDataProvider({ initial, now, children }: AdminDataProviderProps) {
  const [stores] = React.useState<AdminStores>(() => ({
    sports: createCollectionStore(initial.sports),
    leagues: createCollectionStore(initial.leagues),
    seasons: createCollectionStore(initial.seasons),
    teams: createCollectionStore(initial.teams),
    players: createCollectionStore(initial.players),
    matches: createCollectionStore(initial.matches),
    venues: createCollectionStore(initial.venues),
    dataSources: createCollectionStore(initial.dataSources),
    syncLogs: createCollectionStore(initial.syncLogs),
    activity: createCollectionStore(initial.activity),
  }))

  return (
    <AdminContext.Provider value={{ stores, now }}>{children}</AdminContext.Provider>
  )
}

function useAdminContext(): AdminContextValue {
  const context = React.useContext(AdminContext)
  if (!context) {
    throw new Error("Admin hooks must be used within an AdminDataProvider.")
  }
  return context
}

/** Read and change one admin collection. Re-renders on every change. */
export function useAdminCollection<K extends keyof AdminData>(name: K) {
  const store = useAdminContext().stores[name] as CollectionStore<AdminData[K][number]>
  const items = React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  )
  return { items, upsert: store.upsert, remove: store.remove }
}

/** Server reference time for the admin session. */
export function useAdminNow(): Date {
  return new Date(useAdminContext().now)
}

/** Id lookups for joining records across collections. */
export function useAdminLookups() {
  const { items: leagues } = useAdminCollection("leagues")
  const { items: teams } = useAdminCollection("teams")
  const { items: venues } = useAdminCollection("venues")
  const { items: dataSources } = useAdminCollection("dataSources")
  return {
    leagueById: new Map(leagues.map((league) => [league.id, league])),
    teamById: new Map(teams.map((team) => [team.id, team])),
    venueByName: new Map(venues.map((venue) => [venue.name, venue])),
    dataSourceById: new Map(dataSources.map((source) => [source.id, source])),
  }
}
