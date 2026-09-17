"use client"

import * as React from "react"

import { useAdminNotice } from "@/components/admin/admin-data-provider"
import { runDataSourceSync } from "@/lib/data/admin-actions"
import type { DataSource } from "@/lib/data/types"

/**
 * The one Admin "Sync now" path, shared by Data Sources and Monitoring. It
 * calls the existing Server Action, which runs the same `runSync` as the CLI
 * and the scheduler, including the per-source lock: a source already syncing
 * comes back as "Sync already running", never as a second run.
 */
export function useSyncNow() {
  const { notify } = useAdminNotice()
  const [syncingId, setSyncingId] = React.useState<string | null>(null)

  async function sync(source: Pick<DataSource, "id" | "name" | "provider" | "status">) {
    if (syncingId) return
    if (!source.provider) return notify(`${source.name} has no provider bound; nothing to sync.`, "error")
    if (!source.provider.configured) return notify(`${source.name} is not configured: ${source.provider.configurationError ?? "see configuration"}.`, "error")
    setSyncingId(source.id)
    notify(`Syncing ${source.name}…`)
    try {
      const result = await runDataSourceSync(source.id)
      notify(result.ok ? (result.message ?? "Sync finished.") : result.error, result.ok ? "info" : "error")
    } catch {
      notify("Sync failed unexpectedly. Please try again.", "error")
    } finally {
      setSyncingId(null)
    }
  }

  return { sync, syncingId }
}
