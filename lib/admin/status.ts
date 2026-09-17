import type {
  DataSourceStatus,
  EntityStatus,
  SeasonStatus,
  SyncStatus,
} from "@/lib/data/types"

/** Visual tone for a status pill. Colours live in the badge component. */
export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral"

export type AdminStatus = EntityStatus | SeasonStatus | DataSourceStatus | SyncStatus

export const statusMeta: Record<AdminStatus, { label: string; tone: StatusTone }> = {
  active: { label: "Active", tone: "success" },
  inactive: { label: "Inactive", tone: "neutral" },
  current: { label: "Current", tone: "success" },
  upcoming: { label: "Upcoming", tone: "info" },
  completed: { label: "Completed", tone: "neutral" },
  connected: { label: "Connected", tone: "success" },
  disconnected: { label: "Disconnected", tone: "danger" },
  attention: { label: "Needs attention", tone: "warning" },
  running: { label: "Running", tone: "info" },
  success: { label: "Success", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  partial: { label: "Partial", tone: "warning" },
}

import type { SourceHealthState, SyncRunCategory } from "@/lib/data/sync/health"

/** Operational health pills (Admin → Monitoring). Tones follow the same vocabulary as statuses. */
export const healthMeta: Record<SourceHealthState, { label: string; tone: StatusTone }> = {
  healthy: { label: "Healthy", tone: "success" },
  degraded: { label: "Degraded", tone: "warning" },
  stale: { label: "Stale", tone: "warning" },
  failing: { label: "Failing", tone: "danger" },
  syncing: { label: "Syncing", tone: "info" },
  "never-synced": { label: "Never synced", tone: "warning" },
  "not-configured": { label: "Not configured", tone: "neutral" },
  disabled: { label: "Disabled", tone: "neutral" },
  mock: { label: "Mock", tone: "neutral" },
  placeholder: { label: "Placeholder", tone: "neutral" },
}

/** Short labels for why a run ended the way it did (Sync Logs "Kind" column). */
export const runCategoryLabel: Record<SyncRunCategory, string> = {
  ok: "Clean",
  running: "Running",
  issues: "Record issues",
  abandoned: "Abandoned",
  configuration: "Configuration",
  auth: "Credentials",
  "rate-limit": "Rate limited",
  server: "Provider error",
  client: "Request rejected",
  timeout: "Timeout",
  network: "Unreachable",
  malformed: "Malformed response",
  unbound: "No provider",
  failed: "Failed",
}

export const entityStatusOptions: { value: EntityStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
]

export const seasonStatusOptions: { value: SeasonStatus; label: string }[] = [
  { value: "current", label: "Current" },
  { value: "upcoming", label: "Upcoming" },
  { value: "completed", label: "Completed" },
]

export const dataSourceStatusOptions: { value: DataSourceStatus; label: string }[] = [
  { value: "connected", label: "Connected" },
  { value: "disconnected", label: "Disconnected" },
  { value: "attention", label: "Needs attention" },
]

export const syncStatusOptions: { value: SyncStatus; label: string }[] = [
  { value: "running", label: "Running" },
  { value: "success", label: "Success" },
  { value: "partial", label: "Partial" },
  { value: "failed", label: "Failed" },
]
