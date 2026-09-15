"use server"

import { refresh } from "next/cache"

import { getCurrentUserId } from "@/lib/data/current-user"
import { userStateRepository } from "@/lib/data/repositories/user-state-repository"
import { ReminderError } from "@/lib/data/repositories/watchlist-reminder-ops"
import type { WatchlistReminder } from "@/lib/data/types"

/**
 * Server actions that persist the current user's follows and watchlist.
 *
 * Each takes the target id and the desired state, so a client store can call
 * one function for both directions. The repository makes every write
 * idempotent. After a write the client router is refreshed so server-rendered
 * sections that depend on follows (the dashboard's "Today's matches" and
 * "Upcoming matches", the layout's store seeds) reflect the database.
 */

/** Ids arrive from the browser; keep them to the shape the catalogue uses. */
function assertId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) {
    throw new Error(`Invalid ${label}.`)
  }
  return value
}

export async function setTeamFollowed(teamId: string, followed: boolean): Promise<void> {
  const id = assertId(teamId, "team id")
  const userId = await getCurrentUserId()
  if (followed) await userStateRepository.followTeam(userId, id)
  else await userStateRepository.unfollowTeam(userId, id)
  refresh()
}

export async function setPlayerFollowed(playerId: string, followed: boolean): Promise<void> {
  const id = assertId(playerId, "player id")
  const userId = await getCurrentUserId()
  if (followed) await userStateRepository.followPlayer(userId, id)
  else await userStateRepository.unfollowPlayer(userId, id)
  refresh()
}

/** No UI toggles league follows yet; the action exists so one can be added without new server code. */
export async function setLeagueFollowed(leagueId: string, followed: boolean): Promise<void> {
  const id = assertId(leagueId, "league id")
  const userId = await getCurrentUserId()
  if (followed) await userStateRepository.followLeague(userId, id)
  else await userStateRepository.unfollowLeague(userId, id)
  refresh()
}

export async function setMatchWatchlisted(matchId: string, watchlisted: boolean): Promise<void> {
  const id = assertId(matchId, "match id")
  const userId = await getCurrentUserId()
  if (watchlisted) await userStateRepository.addToWatchlist(userId, id)
  else await userStateRepository.removeFromWatchlist(userId, id)
  refresh()
}

export type ReminderActionResult = { ok: true; reminder: WatchlistReminder } | { ok: false; error: string }

/**
 * Store the reminder for a watchlisted match. Returns a result rather than
 * throwing so the client can show the rule that was violated (match already
 * started, not on the watchlist) and roll back its optimistic value. "off"
 * keeps the match on the watchlist; removing the match removes the reminder.
 */
export async function setWatchlistReminder(matchId: string, reminder: WatchlistReminder): Promise<ReminderActionResult> {
  const id = assertId(matchId, "match id")
  const userId = await getCurrentUserId()
  try {
    const stored = await userStateRepository.setWatchlistReminder(userId, id, reminder)
    refresh()
    return { ok: true, reminder: stored }
  } catch (error) {
    if (error instanceof ReminderError) return { ok: false, error: error.message }
    throw error
  }
}
