/**
 * Watchlist state, independent of React. Holds the ids of saved matches.
 * The snapshot is replaced on every change so `useSyncExternalStore` can
 * detect updates by reference. A persistence layer can later wrap `add` and
 * `remove` with API calls and seed the store from the server.
 */

export type WatchlistSnapshot = ReadonlySet<string>

export type WatchlistStore = {
  getSnapshot: () => WatchlistSnapshot
  subscribe: (listener: () => void) => () => void
  has: (matchId: string) => boolean
  add: (matchId: string) => void
  remove: (matchId: string) => void
  toggle: (matchId: string) => void
}

export function createWatchlistStore(
  initialIds: Iterable<string> = []
): WatchlistStore {
  let ids: WatchlistSnapshot = new Set(initialIds)
  const listeners = new Set<() => void>()

  function set(next: Set<string>) {
    ids = next
    for (const listener of listeners) listener()
  }

  function add(matchId: string) {
    if (ids.has(matchId)) return
    set(new Set(ids).add(matchId))
  }

  function remove(matchId: string) {
    if (!ids.has(matchId)) return
    const next = new Set(ids)
    next.delete(matchId)
    set(next)
  }

  return {
    getSnapshot: () => ids,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    has: (matchId) => ids.has(matchId),
    add,
    remove,
    toggle: (matchId) => (ids.has(matchId) ? remove(matchId) : add(matchId)),
  }
}
