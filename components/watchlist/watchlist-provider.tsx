"use client"

import { createIdSetProvider } from "@/components/id-set-provider"

const watchlist = createIdSetProvider("Watchlist")

/** Holds the ids of saved matches for the session. Mounted in the app layout. */
export const WatchlistProvider = watchlist.Provider

/** Read and change the shared watchlist. Re-renders on every change. */
export const useWatchlist = watchlist.useIdSet
