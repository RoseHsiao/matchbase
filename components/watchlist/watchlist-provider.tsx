"use client"

import * as React from "react"

import { createWatchlistStore, type WatchlistStore } from "@/lib/watchlist/store"

const WatchlistContext = React.createContext<WatchlistStore | null>(null)

type WatchlistProviderProps = {
  /** Ids saved on the server, used to seed the client store once. */
  initialIds: string[]
  children: React.ReactNode
}

export function WatchlistProvider({ initialIds, children }: WatchlistProviderProps) {
  const [store] = React.useState(() => createWatchlistStore(initialIds))
  return (
    <WatchlistContext.Provider value={store}>{children}</WatchlistContext.Provider>
  )
}

/** Read and change the shared watchlist. Re-renders on every change. */
export function useWatchlist() {
  const store = React.useContext(WatchlistContext)
  if (!store) {
    throw new Error("useWatchlist must be used within a WatchlistProvider.")
  }
  const ids = React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  )
  return {
    ids,
    count: ids.size,
    has: (matchId: string) => ids.has(matchId),
    add: store.add,
    remove: store.remove,
    toggle: store.toggle,
  }
}
