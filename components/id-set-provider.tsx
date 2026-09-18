"use client"

import * as React from "react"

import { useSignInPrompt } from "@/components/auth/viewer-provider"
import { createIdSetStore, type IdSetStore } from "@/lib/id-set-store"

/** Saves one membership change on the server. `present` is the new state. */
export type PersistIdChange = (id: string, present: boolean) => Promise<void>

type IdSetProviderProps = {
  /** Ids saved on the server. Seeds the client store and re-syncs it on every server render. */
  initialIds: string[]
  /**
   * Server action that persists a change. When omitted the set is
   * session-only. On failure the optimistic change is rolled back.
   */
  persist?: PersistIdChange
  /**
   * True for an anonymous visitor: a change attempt prompts sign-in instead
   * of touching the store. The server rejects the write regardless; this
   * only keeps the UI honest.
   */
  readOnly?: boolean
  children: React.ReactNode
}

type ContextValue = {
  store: IdSetStore
  mutate: (id: string, present: boolean) => void
}

function sameMembers(current: ReadonlySet<string>, ids: readonly string[]): boolean {
  return current.size === ids.length && ids.every((id) => current.has(id))
}

/**
 * Builds a Provider and hook pair around an id-set store. Each feature
 * (watchlist, follows) gets its own context so they never collide.
 *
 * The store is a client cache of server state: the database is the source
 * of truth. Changes apply optimistically, are persisted through `persist`,
 * and the store is re-synced whenever the server sends a fresh `initialIds`
 * (a refresh, a navigation, or the revalidation an action triggers).
 */
export function createIdSetProvider(name: string) {
  const Context = React.createContext<ContextValue | null>(null)

  function Provider({ initialIds, persist, readOnly = false, children }: IdSetProviderProps) {
    const [store] = React.useState(() => createIdSetStore(initialIds))
    const persistRef = React.useRef(persist)
    const promptSignIn = useSignInPrompt()

    React.useEffect(() => {
      persistRef.current = persist
    }, [persist])

    React.useEffect(() => {
      if (!sameMembers(store.getSnapshot(), initialIds)) store.reset(initialIds)
    }, [initialIds, store])

    const value = React.useMemo<ContextValue>(
      () => ({
        store,
        mutate(id, present) {
          if (readOnly) {
            promptSignIn()
            return
          }
          if (store.has(id) === present) return
          if (present) store.add(id)
          else store.remove(id)
          const save = persistRef.current
          if (!save) return
          save(id, present).catch((error: unknown) => {
            // Never leave the UI showing a state the database rejected.
            if (present) store.remove(id)
            else store.add(id)
            console.error(`Could not save ${name} change for "${id}".`, error)
          })
        },
      }),
      [store, readOnly, promptSignIn]
    )

    return <Context.Provider value={value}>{children}</Context.Provider>
  }
  Provider.displayName = `${name}Provider`

  /** Read and change the set. Re-renders on every change. */
  function useIdSet() {
    const context = React.useContext(Context)
    if (!context) {
      throw new Error(`use${name} must be used within a ${name}Provider.`)
    }
    const { store, mutate } = context
    const ids = React.useSyncExternalStore(
      store.subscribe,
      store.getSnapshot,
      store.getSnapshot
    )
    return {
      ids,
      count: ids.size,
      has: (id: string) => ids.has(id),
      add: (id: string) => mutate(id, true),
      remove: (id: string) => mutate(id, false),
      toggle: (id: string) => mutate(id, !store.has(id)),
    }
  }

  return { Provider, useIdSet }
}
