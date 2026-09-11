import { createIdSetStore, type IdSetStore } from "@/lib/id-set-store"

/** Ids of teams or players the user follows. */
export type FollowsStore = IdSetStore

export const createFollowsStore: (initialIds?: Iterable<string>) => FollowsStore =
  createIdSetStore
