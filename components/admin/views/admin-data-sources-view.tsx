"use client"

import * as React from "react"
import { PencilIcon, RefreshCwIcon } from "lucide-react"

import { useAdminCollection, useAdminNow } from "@/components/admin/admin-data-provider"
import { useSyncNow } from "@/components/admin/use-sync-now"
import { AdminDataTable, type AdminColumn } from "@/components/admin/admin-data-table"
import { AdminFormDialog } from "@/components/admin/admin-form-dialog"
import { AdminPage } from "@/components/admin/admin-page"
import { AdminStatusBadge } from "@/components/admin/admin-status-badge"
import { AdminToolbar } from "@/components/admin/admin-toolbar"
import { SelectField, TextField } from "@/components/admin/form-fields"
import { HierarchyFilterSelects, useHierarchyFilters } from "@/components/filters/hierarchy-filters"
import { useEntityEditor } from "@/components/admin/use-entity-editor"
import { CategoryLine, SportLine } from "@/components/sport-icon"
import { FilterSelect } from "@/components/filters/filter-select"
import { dataSourceStatusOptions } from "@/lib/admin/status"
import { Badge } from "@/components/ui/badge"
import type { DataSource, DataSourceStatus, Sport } from "@/lib/data/types"
import { DEFAULT_SCHEDULE_CONFIG } from "@/lib/data/sync/schedule-config"
import { freshnessLabel, getDataSourceFreshness, getSyncExecutionState } from "@/lib/data/sync/freshness"
import { formatRelativeTime } from "@/lib/format"
import { ALL } from "@/lib/schedule"
import { sportCategory, sportLabel, sports } from "@/lib/sports"

const NONE = "none"
type Draft = { name: string; sport: Sport | typeof NONE; status: DataSourceStatus }

/**
 * Which adapter serves the source and whether it can run. Three states are
 * kept visibly apart: no provider (placeholder), provider not configured
 * (e.g. API key missing), provider ready. "Ready" says nothing about whether
 * a sync has ever succeeded; that is the Status and Last synced columns.
 */
function ProviderCell({ source }: { source: DataSource }) {
  const provider = source.provider
  if (!provider) return <span className="text-muted-foreground">None (placeholder)</span>
  return (
    <span className="grid gap-0.5 leading-tight">
      <span className="flex items-center gap-1.5">
        <span className="font-medium">{provider.name}</span>
        <Badge variant={provider.kind === "mock" ? "secondary" : "outline"} className="h-4 px-1.5 text-[10px]">
          {provider.kind === "mock" ? "Mock" : "Live"}
        </Badge>
      </span>
      <span className={provider.configured ? "text-xs text-muted-foreground" : "text-xs text-destructive"} title={provider.configurationError}>
        {provider.configured
          ? provider.kind === "mock"
            ? "Deterministic fixtures, never external data"
            : provider.configurationDetail
              ? `Configured · ${provider.configurationDetail}`
              : "Configured · credentials present, not yet verified against the live API"
          : `Not configured · ${provider.configurationError?.split(";")[0].replace(/\. The .*$/, "") ?? "see configuration"}`}
      </span>
    </span>
  )
}

/**
 * "Is this source being kept fresh?" in one cell: freshness of the last
 * successful run against the scheduled cadence, what the source is doing
 * now, and whether the scheduler includes it. Pure helpers with the admin
 * snapshot's `now`, so the answer is the same on the server and the client.
 */
function FreshnessCell({ source, now }: { source: DataSource; now: Date }) {
  if (!source.provider) return <span className="text-muted-foreground">—</span>
  const freshness = getDataSourceFreshness({ lastSuccessfulSyncAt: source.lastSyncedAt, expectedIntervalMs: DEFAULT_SCHEDULE_CONFIG.expectedIntervalMs, graceMs: DEFAULT_SCHEDULE_CONFIG.graceMs, now })
  const execution = getSyncExecutionState(source.lastRun ? { status: source.lastRun.status } : undefined)
  const tone = freshness.state === "fresh" ? "text-foreground" : freshness.state === "stale" ? "text-destructive" : "text-muted-foreground"
  return (
    <span className="grid gap-0.5 leading-tight">
      <span className={tone}>
        {freshnessLabel(freshness)}
        {execution === "syncing" ? " · syncing now" : execution === "failed" ? ` · last run ${source.lastRun?.status}` : ""}
      </span>
      <span className="text-xs text-muted-foreground" title={source.scheduleReason}>
        {source.scheduled ? "Auto: daily" : `Auto: off · ${source.scheduleReason ?? "not schedulable"}`}
      </span>
    </span>
  )
}

export function AdminDataSourcesView() {
  const now = useAdminNow()
  const { items: dataSources, upsert } = useAdminCollection("dataSources")
  const { items: leagues } = useAdminCollection("leagues")
  const hierarchy = useHierarchyFilters({ category: ALL, sport: ALL, leagueId: ALL, status: ALL }, leagues)
  const { filters, update } = hierarchy
  const editor = useEntityEditor<Draft>({ name: "", sport: NONE, status: "connected" })
  const { sync } = useSyncNow()

  const rows = dataSources.filter(
    (source) =>
      (filters.category === ALL || (source.sport !== undefined && sportCategory(source.sport) === filters.category)) &&
      (filters.sport === ALL || source.sport === filters.sport) &&
      (filters.status === ALL || source.status === filters.status)
  )

  const columns: AdminColumn<DataSource>[] = [
    { key: "name", header: "Source", cell: (row) => <span className="font-medium">{row.name}</span>, sortValue: (row) => row.name },
    { key: "category", header: "Category", cell: (row) => (row.sport ? <CategoryLine category={sportCategory(row.sport)} size="sm" /> : <span className="text-muted-foreground">All</span>) },
    { key: "sport", header: "Sport / Game", cell: (row) => (row.sport ? <SportLine sport={row.sport} /> : <span className="text-muted-foreground">Cross-discipline</span>), sortValue: (row) => (row.sport ? sportLabel(row.sport) : "") },
    {
      key: "provider",
      header: "Provider",
      cell: (row) => <ProviderCell source={row} />,
      sortValue: (row) => (row.provider ? `${row.provider.kind}-${row.provider.name}` : "zzz"),
    },
    { key: "status", header: "Status", cell: (row) => <AdminStatusBadge status={row.status} />, sortValue: (row) => row.status },
    { key: "synced", header: "Last synced", cell: (row) => (row.lastSyncedAt ? <time dateTime={row.lastSyncedAt}>{formatRelativeTime(row.lastSyncedAt, now)}</time> : "Never"), sortValue: (row) => row.lastSyncedAt ?? "", className: "whitespace-nowrap" },
    { key: "freshness", header: "Freshness", cell: (row) => <FreshnessCell source={row} now={now} />, sortValue: (row) => (row.scheduled ? "1" : "0") + (row.lastSyncedAt ?? "") },
  ]

  return (
    <AdminPage
      title="Data Sources"
      description="Feeds that populate the catalogue. A source is synced only through its bound provider: mock providers serve deterministic fixtures, live providers call the external API from the server with credentials from the environment. Sources without a provider are placeholders."
    >
      <AdminToolbar activeCount={hierarchy.activeCount} onReset={hierarchy.reset}>
        <HierarchyFilterSelects idPrefix="admin-sources" filters={filters} update={update} sportOptions={hierarchy.sportOptions} leagueOptions={hierarchy.leagueOptions} showLeague={false} />
        <FilterSelect id="admin-sources-status" label="Status" allLabel="All" value={filters.status} onChange={(status) => update({ status })} options={dataSourceStatusOptions} />
      </AdminToolbar>

      <AdminDataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        noun="source"
        defaultSort={{ key: "name", direction: "asc" }}
        rowActions={[
          { label: "Sync now", icon: RefreshCwIcon, onSelect: (row) => void sync(row) },
          { label: "Edit", icon: PencilIcon, onSelect: (row) => editor.openEdit(row.id, { name: row.name, sport: row.sport ?? NONE, status: row.status }) },
        ]}
        emptyTitle="No data sources match"
      />

      <AdminFormDialog
        open={editor.open}
        onOpenChange={editor.setOpen}
        title="Edit data source"
        description="Connection details arrive with the integration phase; only the name, scope, and status are editable now."
        submitLabel="Save changes"
        onSubmit={() => {
          if (!editor.editingId) return
          const existing = dataSources.find((s) => s.id === editor.editingId)
          upsert({
            id: editor.editingId,
            name: editor.draft.name.trim(),
            sport: editor.draft.sport === NONE ? undefined : editor.draft.sport,
            status: editor.draft.status,
            lastSyncedAt: existing?.lastSyncedAt,
            provider: existing?.provider,
          })
          editor.close()
        }}
      >
        <TextField id="source-name" label="Name" value={editor.draft.name} onChange={(name) => editor.patch({ name })} required full />
        <SelectField id="source-sport" label="Scope" value={editor.draft.sport} onChange={(sport) => editor.patch({ sport: sport as Draft["sport"] })} options={[{ value: NONE, label: "Cross-discipline" }, ...sports.map((s) => ({ value: s, label: sportLabel(s) }))]} />
        <SelectField id="source-status" label="Status" value={editor.draft.status} onChange={(status) => editor.patch({ status: status as DataSourceStatus })} options={dataSourceStatusOptions} />
      </AdminFormDialog>
    </AdminPage>
  )
}
