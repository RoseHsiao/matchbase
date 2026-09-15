"use server"

import { refresh } from "next/cache"

import { getCurrentUserId } from "@/lib/data/current-user"
import { userStateRepository } from "@/lib/data/repositories/user-state-repository"

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
