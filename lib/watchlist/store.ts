import { createIdSetStore, type IdSetStore } from "@/lib/id-set-store"

/** Ids of matches the user has saved. */
export type WatchlistStore = IdSetStore

export const createWatchlistStore: (initialIds?: Iterable<string>) => WatchlistStore =
  createIdSetStore
