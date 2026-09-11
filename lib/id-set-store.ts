/**
 * Minimal store for a set of ids (watchlist, followed teams, and so on).
 * Independent of React. The snapshot is replaced on every change so
 * `useSyncExternalStore` can detect updates by reference. A persistence
 * layer can later wrap `add` and `remove` and seed the store from the server.
 */

export type IdSetSnapshot = ReadonlySet<string>

export type IdSetStore = {
  getSnapshot: () => IdSetSnapshot
  subscribe: (listener: () => void) => () => void
  has: (id: string) => boolean
  add: (id: string) => void
  remove: (id: string) => void
  toggle: (id: string) => void
}

export function createIdSetStore(initialIds: Iterable<string> = []): IdSetStore {
  let ids: IdSetSnapshot = new Set(initialIds)
  const listeners = new Set<() => void>()

  function set(next: Set<string>) {
    ids = next
    for (const listener of listeners) listener()
  }

  function add(id: string) {
    if (ids.has(id)) return
    set(new Set(ids).add(id))
  }

  function remove(id: string) {
    if (!ids.has(id)) return
    const next = new Set(ids)
    next.delete(id)
    set(next)
  }

  return {
    getSnapshot: () => ids,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    has: (id) => ids.has(id),
    add,
    remove,
    toggle: (id) => (ids.has(id) ? remove(id) : add(id)),
  }
}
