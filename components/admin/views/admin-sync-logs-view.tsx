"use client"

import * as React from "react"

import { useAdminCollection, useAdminLookups } from "@/components/admin/admin-data-provider"
import { AdminDataTable, type AdminColumn } from "@/components/admin/admin-data-table"
import { AdminPage } from "@/components/admin/admin-page"
import { AdminStatusBadge } from "@/components/admin/admin-status-badge"
import { AdminToolbar } from "@/components/admin/admin-toolbar"
import { FilterSelect } from "@/components/filters/filter-select"
import { syncStatusOptions } from "@/lib/admin/status"
import type { SyncLog } from "@/lib/data/types"
import { formatDateTime, formatDuration } from "@/lib/format"
import { ALL } from "@/lib/schedule"

const entityOptions = [
  { value: "all", label: "Full sync" },
  { value: "matches", label: "Matches" },
  { value: "teams", label: "Teams" },
  { value: "players", label: "Players" },
  { value: "leagues", label: "Leagues" },
]

export function AdminSyncLogsView() {
  const { items: syncLogs } = useAdminCollection("syncLogs")
  const { items: dataSources } = useAdminCollection("dataSources")
  const { dataSourceById } = useAdminLookups()
  const [source, setSource] = React.useState<string>(ALL)
  const [entity, setEntity] = React.useState<string>(ALL)
  const [status, setStatus] = React.useState<string>(ALL)

  const rows = syncLogs.filter(
    (log) =>
      (source === ALL || log.dataSourceId === source) &&
      (entity === ALL || log.entity === entity) &&
      (status === ALL || log.status === status)
  )
  const activeCount = [source, entity, status].filter((v) => v !== ALL).length
  const reset = () => { setSource(ALL); setEntity(ALL); setStatus(ALL) }

  const columns: AdminColumn<SyncLog>[] = [
    { key: "at", header: "Date / Time", cell: (row) => <time dateTime={row.at} className="tabular-nums">{formatDateTime(row.at)}</time>, sortValue: (row) => row.at, className: "whitespace-nowrap" },
    { key: "source", header: "Data source", cell: (row) => <span className="font-medium">{dataSourceById.get(row.dataSourceId)?.name ?? row.dataSourceId}</span>, sortValue: (row) => dataSourceById.get(row.dataSourceId)?.name ?? "" },
    { key: "entity", header: "Entity", cell: (row) => <span className="capitalize">{row.entity}</span>, sortValue: (row) => row.entity },
    { key: "records", header: "Records", cell: (row) => `${row.records} ${row.records === 1 ? "record" : "records"}`, sortValue: (row) => row.records, className: "tabular-nums whitespace-nowrap" },
    { key: "status", header: "Status", cell: (row) => <AdminStatusBadge status={row.status} />, sortValue: (row) => row.status },
    { key: "duration", header: "Duration", cell: (row) => formatDuration(row.durationMs), sortValue: (row) => row.durationMs, className: "tabular-nums whitespace-nowrap" },
  ]

  return (
    <AdminPage
      title="Sync Logs"
      description="History of synchronisation runs per data source. Read-only; real runs will append here once integrations exist."
    >
      <AdminToolbar activeCount={activeCount} onReset={reset}>
        <FilterSelect id="admin-logs-source" label="Data source" allLabel="All sources" value={source} onChange={setSource} options={dataSources.map((s) => ({ value: s.id, label: s.name }))} />
        <FilterSelect id="admin-logs-entity" label="Entity" allLabel="All entities" value={entity} onChange={setEntity} options={entityOptions} />
        <FilterSelect id="admin-logs-status" label="Status" allLabel="All" value={status} onChange={setStatus} options={syncStatusOptions} />
      </AdminToolbar>

      <AdminDataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        noun="run"
        defaultSort={{ key: "at", direction: "desc" }}
        emptyTitle="No sync runs match"
        emptyDescription="Adjust the filters to see other runs."
      />
    </AdminPage>
  )
}
