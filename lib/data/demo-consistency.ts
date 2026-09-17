import type { Match, UserFollows } from "@/lib/data/types"
import type { DemoClock } from "@/lib/demo-clock"
import { getReminderAt, isReminderAvailable } from "@/lib/reminders"

/**
 * Coherence rules for time-relative demo data. Statuses in the demo timeline
 * are authored, not derived from the clock (exactly as with real provider
 * data), so these checks make sure the authored status, the generated start
 * instant, the scores and the demo user's reminders cannot contradict each
 * other for a given anchor. The seed refuses to write an incoherent set.
 *
 * Applies to demo data only. Real provider rows carry their own timestamps
 * and statuses and are never evaluated here.
 */

/** A live match must have started within this window before the anchor. */
export const LIVE_WINDOW_MS = 6 * 3_600_000

export type DemoDataSubset = {
  matches: readonly Match[]
  follows: Pick<UserFollows, "watchlistMatchIds" | "watchlistReminders">
}

/** Every rule violation, as a readable sentence. Empty when the data is coherent. */
export function checkDemoConsistency(data: DemoDataSubset, clock: DemoClock): string[] {
  const issues: string[] = []
  const anchor = clock.anchor.getTime()
  const byId = new Map(data.matches.map((match) => [match.id, match]))

  for (const match of data.matches) {
    const start = Date.parse(match.startsAt)
    if (Number.isNaN(start)) {
      issues.push(`${match.id}: startsAt "${match.startsAt}" is not an instant.`)
      continue
    }
    switch (match.status) {
      case "upcoming":
        if (start <= anchor) issues.push(`${match.id}: upcoming but starts at or before the anchor.`)
        if (match.score) issues.push(`${match.id}: upcoming but has a score.`)
        break
      case "live":
        if (start > anchor) issues.push(`${match.id}: live but starts after the anchor.`)
        if (anchor - start > LIVE_WINDOW_MS) issues.push(`${match.id}: live but started more than ${LIVE_WINDOW_MS / 3_600_000} h before the anchor.`)
        break
      case "finished":
        if (start >= anchor) issues.push(`${match.id}: finished but starts at or after the anchor.`)
        if (!match.score) issues.push(`${match.id}: finished without a score.`)
        if (match.liveDetail) issues.push(`${match.id}: finished but carries live detail.`)
        break
    }
  }

  for (const matchId of data.follows.watchlistMatchIds) {
    if (!byId.has(matchId)) issues.push(`watchlist references unknown match ${matchId}.`)
  }
  for (const [matchId, reminder] of Object.entries(data.follows.watchlistReminders)) {
    if (reminder === "off") continue
    const match = byId.get(matchId)
    if (!match) {
      issues.push(`reminder on unknown match ${matchId}.`)
      continue
    }
    if (!data.follows.watchlistMatchIds.includes(matchId)) issues.push(`${matchId}: reminder set but the match is not on the watchlist.`)
    if (!isReminderAvailable(match.status)) issues.push(`${matchId}: reminder "${reminder}" on a ${match.status} match.`)
    const firesAt = getReminderAt(match.startsAt, reminder)
    if (firesAt && firesAt.getTime() <= anchor) issues.push(`${matchId}: reminder "${reminder}" would already have fired at the anchor.`)
  }

  return issues
}
