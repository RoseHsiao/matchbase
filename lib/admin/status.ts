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
  success: { label: "Success", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  partial: { label: "Partial", tone: "warning" },
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
  { value: "success", label: "Success" },
  { value: "partial", label: "Partial" },
  { value: "failed", label: "Failed" },
]
