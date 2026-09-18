"use server"

import { refresh } from "next/cache"

import { isAuthorizationError } from "@/lib/auth/authorization"
import { requireAdmin } from "@/lib/auth/session"
import { db } from "@/lib/data/db"
import { AdminError, adminRepository } from "@/lib/data/repositories/admin-repository"
import { loadRecentRuns } from "@/lib/data/repositories/monitoring-ops"
import { manualSyncPolicy } from "@/lib/data/sync/manual-sync-policy"
import { readScheduleConfig } from "@/lib/data/sync/schedule-config"
import { syncDataSource } from "@/lib/data/sync/sync-service"
import { providerSyncPolicy } from "@/lib/env/runtime-environment"
import { logServerError } from "@/lib/logging/server-log"

/**
 * Server boundary for Admin CRUD and manual sync. Every action authorizes
 * first (`requireAdmin`, before any validation, repository call or provider
 * request) and returns a result rather than throwing: a `{ ok: false }`
 * tells the client store to roll back and show the message. Only AdminError
 * and authorization messages are shown; anything else is logged on the
 * server and reported generically.
 */

export type AdminActionResult = { ok: true; message?: string } | { ok: false; error: string }

/** Collections the Admin UI can write. Sync logs and activity are read-only. */
export type AdminMutableCollection =
  | "sports"
  | "leagues"
  | "seasons"
  | "teams"
  | "players"
  | "venues"
  | "matches"
  | "dataSources"

const savers: Record<AdminMutableCollection, (input: unknown) => Promise<void>> = {
  sports: (input) => adminRepository.saveSport(input),
  leagues: (input) => adminRepository.saveLeague(input),
  seasons: (input) => adminRepository.saveSeason(input),
  teams: (input) => adminRepository.saveTeam(input),
  players: (input) => adminRepository.savePlayer(input),
  venues: (input) => adminRepository.saveVenue(input),
  matches: (input) => adminRepository.saveMatch(input),
  dataSources: (input) => adminRepository.saveDataSource(input),
}

const deleters: Partial<Record<AdminMutableCollection, (id: string) => Promise<void>>> = {
  leagues: (id) => adminRepository.deleteLeague(id),
  seasons: (id) => adminRepository.deleteSeason(id),
  teams: (id) => adminRepository.deleteTeam(id),
  players: (id) => adminRepository.deletePlayer(id),
  venues: (id) => adminRepository.deleteVenue(id),
  matches: (id) => adminRepository.deleteMatch(id),
}

/** The failure result for a caller who is not an administrator, or null when they are. */
async function denyUnlessAdmin(): Promise<AdminActionResult | null> {
  try {
    await requireAdmin()
    return null
  } catch (error) {
    if (isAuthorizationError(error)) {
      return { ok: false, error: error.kind === "unauthenticated" ? "Sign in as an administrator to make changes." : "Only administrators can make changes." }
    }
    throw error
  }
}

async function run(work: () => Promise<void>): Promise<AdminActionResult> {
  try {
    await work()
    // Re-render the current route so the admin snapshot (and any derived
    // labels) comes back from the database; user-facing pages are dynamic
    // and read the database on their next request.
    refresh()
    return { ok: true }
  } catch (error) {
    if (error instanceof AdminError) return { ok: false, error: error.message }
    logServerError("admin-mutation", error)
    return { ok: false, error: "The change could not be saved. Please try again." }
  }
}

export async function saveAdminRecord(collection: string, item: unknown): Promise<AdminActionResult> {
  const denied = await denyUnlessAdmin()
  if (denied) return denied
  const save = savers[collection as AdminMutableCollection]
  if (!save) return { ok: false, error: "This collection cannot be edited." }
  return run(() => save(item))
}

/**
 * Runs one synchronisation for a data source, then refreshes the admin
 * snapshot so the new sync log, lastSyncedAt, and any synced catalogue rows
 * appear. Provider credentials never leave the server. The per-source lock
 * inside `syncDataSource` is unchanged; a Preview deployment refuses before
 * reaching it unless the operator opted in.
 */
export async function runDataSourceSync(dataSourceId: unknown): Promise<AdminActionResult> {
  const denied = await denyUnlessAdmin()
  if (denied) return denied
  const policy = providerSyncPolicy(process.env)
  if (!policy.allowed) return { ok: false, error: `Sync not run: ${policy.reason}` }
  if (typeof dataSourceId !== "string" || dataSourceId.length === 0 || dataSourceId.length > 200) return { ok: false, error: "Invalid data source id." }
  try {
    // Cooldown from the source's own history: a fresh successful run is not repeated on demand, a failed one may be retried at once.
    const cooldown = manualSyncPolicy({ runs: await loadRecentRuns(db, dataSourceId), now: new Date(), cooldownMs: readScheduleConfig().manualCooldownMs })
    if (!cooldown.allowed) return { ok: false, error: `Sync not run: ${cooldown.reason}` }
    const result = await syncDataSource(dataSourceId)
    refresh()
    if (result.status === "SKIPPED") return { ok: true, message: `Sync already running: ${result.error ?? "another run holds this source."}` }
    if (result.status === "FAILED") {
      const prefix = result.errorKind === "configuration" ? "Sync not run" : "Sync failed"
      return { ok: false, error: `${prefix}: ${result.error ?? "see the sync log."}` }
    }
    const failed = Object.values(result.counts).reduce((sum, c) => sum + c.failed, 0)
    const detail = result.status === "PARTIAL" ? ` (${failed} failed, see the sync log)` : ""
    return { ok: true, message: `Sync ${result.status.toLowerCase()}: ${result.records} records in ${result.durationMs} ms${detail}.` }
  } catch (error) {
    logServerError("admin-sync", error)
    return { ok: false, error: "Sync failed unexpectedly. Please try again." }
  }
}

export async function deleteAdminRecord(collection: string, id: unknown): Promise<AdminActionResult> {
  const denied = await denyUnlessAdmin()
  if (denied) return denied
  const remove = deleters[collection as AdminMutableCollection]
  if (!remove) return { ok: false, error: "This collection cannot be deleted from." }
  if (typeof id !== "string" || id.length === 0 || id.length > 200) return { ok: false, error: "Invalid id." }
  return run(() => remove(id))
}
