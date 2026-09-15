"use client"

import * as React from "react"
import { XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { createCollectionStore, type CollectionStore } from "@/lib/collection-store"
import type { AdminActionResult } from "@/lib/data/admin-actions"
import type { AdminData } from "@/lib/data/types"

type AdminStores = {
  [K in keyof AdminData]: CollectionStore<AdminData[K][number]>
}

/** Server actions that persist a collection change; `{ ok: false }` rolls back. */
export type AdminPersist = {
  save: (collection: string, item: unknown) => Promise<AdminActionResult>
  remove: (collection: string, id: string) => Promise<AdminActionResult>
}

export type AdminNotice = { tone: "error" | "info"; message: string }

type AdminContextValue = {
  stores: AdminStores
  persist?: AdminPersist
  /** Server reference time as ISO, so relative labels agree on both sides. */
  now: string
  notice: AdminNotice | null
  setNotice: (notice: AdminNotice | null) => void
}

const AdminContext = React.createContext<AdminContextValue | null>(null)

type AdminDataProviderProps = {
  initial: AdminData
  now: string
  persist?: AdminPersist
  children: React.ReactNode
}

function createStores(initial: AdminData): AdminStores {
  return {
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
  }
}

function resetStores(stores: AdminStores, snapshot: AdminData) {
  stores.sports.reset(snapshot.sports)
  stores.leagues.reset(snapshot.leagues)
  stores.seasons.reset(snapshot.seasons)
  stores.teams.reset(snapshot.teams)
  stores.players.reset(snapshot.players)
  stores.matches.reset(snapshot.matches)
  stores.venues.reset(snapshot.venues)
  stores.dataSources.reset(snapshot.dataSources)
  stores.syncLogs.reset(snapshot.syncLogs)
  stores.activity.reset(snapshot.activity)
}

/**
 * Holds every admin collection in a client store as a cache of the database
 * snapshot the server layout passes in. Edits apply optimistically, are
 * persisted through `persist`, and are rolled back with a visible message if
 * the server rejects them. Whenever the server sends a fresh snapshot (after a
 * mutation's refresh or a reload) the stores are reset to it, so PostgreSQL
 * stays the source of truth.
 */
export function AdminDataProvider({ initial, now, persist, children }: AdminDataProviderProps) {
  const [stores] = React.useState<AdminStores>(() => createStores(initial))
  const [notice, setNotice] = React.useState<AdminNotice | null>(null)

  React.useEffect(() => {
    resetStores(stores, initial)
  }, [initial, stores])

  const value = React.useMemo<AdminContextValue>(
    () => ({ stores, persist, now, notice, setNotice }),
    [stores, persist, now, notice]
  )

  return (
    <AdminContext.Provider value={value}>
      {notice ? <AdminNoticeBanner notice={notice} onDismiss={() => setNotice(null)} /> : null}
      {children}
    </AdminContext.Provider>
  )
}

function AdminNoticeBanner({ notice, onDismiss }: { notice: AdminNotice; onDismiss: () => void }) {
  const isError = notice.tone === "error"
  return (
    <div
      role={isError ? "alert" : "status"}
      className={
        isError
          ? "flex items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
          : "flex items-start justify-between gap-3 rounded-lg border bg-muted/60 px-4 py-3 text-sm"
      }
    >
      <span>
        {isError ? <span className="font-medium">Change not saved. </span> : null}
        {notice.message}
      </span>
      <Button variant="ghost" size="icon-sm" className="-mr-1 shrink-0 cursor-pointer" aria-label="Dismiss" onClick={onDismiss}>
        <XIcon />
      </Button>
    </div>
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
  type Item = AdminData[K][number]
  const { stores, persist, setNotice } = useAdminContext()
  const setError = (message: string) => setNotice({ tone: "error", message })
  const store = stores[name] as CollectionStore<Item>
  const items = React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  )

  function upsert(item: Item) {
    const previous = store.getSnapshot().find((entry) => entry.id === item.id)
    store.upsert(item)
    if (!persist) return
    persist.save(name, item).then(
      (result) => {
        if (result.ok) return
        if (previous) store.upsert(previous)
        else store.remove(item.id)
        setError(result.error)
      },
      () => {
        if (previous) store.upsert(previous)
        else store.remove(item.id)
        setError("The change could not be saved. Please try again.")
      }
    )
  }

  function remove(id: string) {
    const previous = store.getSnapshot().find((entry) => entry.id === id)
    if (!previous) return
    store.remove(id)
    if (!persist) return
    persist.remove(name, id).then(
      (result) => {
        if (result.ok) return
        store.upsert(previous)
        setError(result.error)
      },
      () => {
        store.upsert(previous)
        setError("The change could not be saved. Please try again.")
      }
    )
  }

  return { items, upsert, remove }
}

/** Show a message above the admin content, e.g. the outcome of a sync run. */
export function useAdminNotice() {
  const { setNotice } = useAdminContext()
  return {
    notify: (message: string, tone: AdminNotice["tone"] = "info") => setNotice({ tone, message }),
    clear: () => setNotice(null),
  }
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
    venueById: new Map(venues.map((venue) => [venue.id, venue])),
    dataSourceById: new Map(dataSources.map((source) => [source.id, source])),
  }
}
