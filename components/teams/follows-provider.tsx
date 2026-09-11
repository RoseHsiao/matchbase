"use client"

import { createIdSetProvider } from "@/components/id-set-provider"

const follows = createIdSetProvider("Follows")

/** Holds the ids of followed teams for the session. Mounted in the app layout. */
export const FollowsProvider = follows.Provider

/** Read and change followed teams. Re-renders on every change. */
export const useFollows = follows.useIdSet
