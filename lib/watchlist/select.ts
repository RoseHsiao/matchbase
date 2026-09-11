import type { MatchStatus, MatchView } from "@/lib/data/types"

const STATUS_ORDER: Record<MatchStatus, number> = {
  live: 0,
  upcoming: 1,
  finished: 2,
}

export type WatchlistOrder = "time" | "status"

/**
 * Pick the saved matches out of a match pool.
 * "time" orders chronologically; "status" puts live first, then upcoming.
 */
export function selectWatchlistMatches(
  pool: MatchView[],
  ids: ReadonlySet<string>,
  order: WatchlistOrder = "time",
  limit?: number
): MatchView[] {
  const saved = pool.filter((match) => ids.has(match.id))
  saved.sort((a, b) =>
    order === "status"
      ? STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        a.startsAt.localeCompare(b.startsAt)
      : a.startsAt.localeCompare(b.startsAt)
  )
  return limit === undefined ? saved : saved.slice(0, limit)
}
