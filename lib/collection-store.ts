/**
 * Minimal store for a list of records with ids, the collection counterpart of
 * `createIdSetStore`. The snapshot array is replaced on every change so
 * `useSyncExternalStore` can detect updates by reference. A persistence layer
 * can later wrap `upsert` and `remove` with API calls.
 */

export type CollectionStore<T extends { id: string }> = {
  getSnapshot: () => readonly T[]
  subscribe: (listener: () => void) => () => void
  upsert: (item: T) => void
  remove: (id: string) => void
  /** Replace every item, e.g. with a fresh snapshot from the server. */
  reset: (items: readonly T[]) => void
}

export function createCollectionStore<T extends { id: string }>(
  initial: readonly T[] = []
): CollectionStore<T> {
  let items: readonly T[] = [...initial]
  const listeners = new Set<() => void>()

  function set(next: readonly T[]) {
    items = next
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => items,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    upsert(item) {
      const index = items.findIndex((entry) => entry.id === item.id)
      set(
        index === -1
          ? [...items, item]
          : items.map((entry, i) => (i === index ? item : entry))
      )
    },
    remove(id) {
      if (!items.some((entry) => entry.id === id)) return
      set(items.filter((entry) => entry.id !== id))
    },
    reset(next) {
      set([...next])
    },
  }
}

/** Short unique id for records created in the browser. */
export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
