"use client"

import { createIdSetProvider } from "@/components/id-set-provider"

const playerFollows = createIdSetProvider("PlayerFollows")

/** Holds the ids of followed players for the session. Mounted in the app layout. */
export const PlayerFollowsProvider = playerFollows.Provider

/** Read and change followed players. Re-renders on every change. */
export const usePlayerFollows = playerFollows.useIdSet
