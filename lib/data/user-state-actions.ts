"use server"

import { refresh } from "next/cache"

import { isAuthorizationError } from "@/lib/auth/authorization"
import { requireUser } from "@/lib/auth/session"
import { userStateRepository } from "@/lib/data/repositories/user-state-repository"
import { ReminderError } from "@/lib/data/repositories/watchlist-reminder-ops"
import type { WatchlistReminder } from "@/lib/data/types"

/**
 * Server actions that persist the signed-in user's follows and watchlist.
 *
 * Every action resolves the viewer from the session first (`requireUser`),
 * before it looks at its arguments: an anonymous caller is rejected before
 * any validation or database access, and the user id written to a row is
 * always the session's, never anything the browser sent. The repository
 * makes every write idempotent. After a write the client router is
 * refreshed so server-rendered sections that depend on follows (the
 * dashboard's "Today's matches", the layout's store seeds) reflect the database.
 */

/** Ids arrive from the browser; keep them to the shape the catalogue uses. */
function assertId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) {
    throw new Error(`Invalid ${label}.`)
  }
  return value
}

export async function setTeamFollowed(teamId: string, followed: boolean): Promise<void> {
  const user = await requireUser()
  const id = assertId(teamId, "team id")
  if (followed) await userStateRepository.followTeam(user.id, id)
  else await userStateRepository.unfollowTeam(user.id, id)
  refresh()
}

export async function setPlayerFollowed(playerId: string, followed: boolean): Promise<void> {
  const user = await requireUser()
  const id = assertId(playerId, "player id")
  if (followed) await userStateRepository.followPlayer(user.id, id)
  else await userStateRepository.unfollowPlayer(user.id, id)
  refresh()
}

/** No UI toggles league follows yet; the action exists so one can be added without new server code. */
export async function setLeagueFollowed(leagueId: string, followed: boolean): Promise<void> {
  const user = await requireUser()
  const id = assertId(leagueId, "league id")
  if (followed) await userStateRepository.followLeague(user.id, id)
  else await userStateRepository.unfollowLeague(user.id, id)
  refresh()
}

export async function setMatchWatchlisted(matchId: string, watchlisted: boolean): Promise<void> {
  const user = await requireUser()
  const id = assertId(matchId, "match id")
  if (watchlisted) await userStateRepository.addToWatchlist(user.id, id)
  else await userStateRepository.removeFromWatchlist(user.id, id)
  refresh()
}

export type ReminderActionResult = { ok: true; reminder: WatchlistReminder } | { ok: false; error: string }

/**
 * Store the reminder for a watchlisted match. Returns a result rather than
 * throwing so the client can show the rule that was violated (not signed
 * in, match already started, not on the watchlist) and roll back its
 * optimistic value. "off" keeps the match on the watchlist; removing the
 * match removes the reminder.
 */
export async function setWatchlistReminder(matchId: string, reminder: WatchlistReminder): Promise<ReminderActionResult> {
  try {
    const user = await requireUser()
    const id = assertId(matchId, "match id")
    const stored = await userStateRepository.setWatchlistReminder(user.id, id, reminder)
    refresh()
    return { ok: true, reminder: stored }
  } catch (error) {
    if (isAuthorizationError(error)) return { ok: false, error: "Sign in to set reminders." }
    if (error instanceof ReminderError) return { ok: false, error: error.message }
    throw error
  }
}
