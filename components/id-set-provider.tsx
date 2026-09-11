"use client"

import * as React from "react"

import { createIdSetStore, type IdSetStore } from "@/lib/id-set-store"

type IdSetProviderProps = {
  /** Ids saved on the server, used to seed the client store once. */
  initialIds: string[]
  children: React.ReactNode
}

/**
 * Builds a Provider and hook pair around an id-set store. Each feature
 * (watchlist, follows) gets its own context so they never collide.
 */
export function createIdSetProvider(name: string) {
  const Context = React.createContext<IdSetStore | null>(null)

  function Provider({ initialIds, children }: IdSetProviderProps) {
    const [store] = React.useState(() => createIdSetStore(initialIds))
    return <Context.Provider value={store}>{children}</Context.Provider>
  }
  Provider.displayName = `${name}Provider`

  /** Read and change the set. Re-renders on every change. */
  function useIdSet() {
    const store = React.useContext(Context)
    if (!store) {
      throw new Error(`use${name} must be used within a ${name}Provider.`)
    }
    const ids = React.useSyncExternalStore(
      store.subscribe,
      store.getSnapshot,
      store.getSnapshot
    )
    return {
      ids,
      count: ids.size,
      has: (id: string) => ids.has(id),
      add: store.add,
      remove: store.remove,
      toggle: store.toggle,
    }
  }

  return { Provider, useIdSet }
}
