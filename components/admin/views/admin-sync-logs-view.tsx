"use client"

import * as React from "react"
import { FileTextIcon } from "lucide-react"

import { useAdminCollection, useAdminLookups } from "@/components/admin/admin-data-provider"
import { AdminDataTable, type AdminColumn } from "@/components/admin/admin-data-table"
import { AdminPage } from "@/components/admin/admin-page"
import { AdminStatusBadge } from "@/components/admin/admin-status-badge"
import { AdminToolbar } from "@/components/admin/admin-toolbar"
import { FilterSelect } from "@/components/filters/filter-select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { runCategoryLabel, syncStatusOptions } from "@/lib/admin/status"
import { describeRun, summarizeRun, type SyncRunCategory } from "@/lib/data/sync/health"
import type { SyncLog } from "@/lib/data/types"
import { formatDateTime, formatDuration } from "@/lib/format"
import { ALL } from "@/lib/schedule"

const kindOptions: { value: SyncRunCategory; label: string }[] = (Object.keys(runCategoryLabel) as SyncRunCategory[]).filter((k) => k !== "running").map((k) => ({ value: k, label: runCategoryLabel[k] }))

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
  const [kind, setKind] = React.useState<string>(ALL)
  const [open, setOpen] = React.useState<SyncLog | null>(null)

  const summaries = new Map(syncLogs.map((log) => [log.id, summarizeRun({ id: log.id, status: log.status, at: log.at, durationMs: log.durationMs, records: log.records, error: log.error })]))
  const rows = syncLogs.filter(
    (log) =>
      (source === ALL || log.dataSourceId === source) &&
      (entity === ALL || log.entity === entity) &&
      (status === ALL || log.status === status) &&
      (kind === ALL || summaries.get(log.id)?.category === kind)
  )
  const activeCount = [source, entity, status, kind].filter((v) => v !== ALL).length
  const reset = () => { setSource(ALL); setEntity(ALL); setStatus(ALL); setKind(ALL) }
  const openRun = open ? summaries.get(open.id) : undefined

  const columns: AdminColumn<SyncLog>[] = [
    { key: "at", header: "Date / Time", cell: (row) => <time dateTime={row.at} className="tabular-nums">{formatDateTime(row.at)}</time>, sortValue: (row) => row.at, className: "whitespace-nowrap" },
    { key: "source", header: "Data source", cell: (row) => <span className="font-medium">{dataSourceById.get(row.dataSourceId)?.name ?? row.dataSourceId}</span>, sortValue: (row) => dataSourceById.get(row.dataSourceId)?.name ?? "" },
    { key: "entity", header: "Entity", cell: (row) => <span className="capitalize">{row.entity}</span>, sortValue: (row) => row.entity },
    { key: "records", header: "Records", cell: (row) => `${row.records} ${row.records === 1 ? "record" : "records"}`, sortValue: (row) => row.records, className: "tabular-nums whitespace-nowrap" },
    { key: "status", header: "Status", cell: (row) => <AdminStatusBadge status={row.status} />, sortValue: (row) => row.status },
    { key: "duration", header: "Duration", cell: (row) => formatDuration(row.durationMs), sortValue: (row) => row.durationMs, className: "tabular-nums whitespace-nowrap" },
    {
      key: "kind",
      header: "Kind",
      cell: (row) => {
        const run = summaries.get(row.id)
        return run ? <span className="whitespace-nowrap text-xs">{runCategoryLabel[run.category]}</span> : null
      },
      sortValue: (row) => summaries.get(row.id)?.category ?? "",
    },
    {
      key: "detail",
      header: "Details",
      cell: (row) => {
        const run = summaries.get(row.id)
        if (!run || !run.summary) return <span className="text-xs text-muted-foreground">—</span>
        return (
          <button type="button" onClick={() => setOpen(row)} className="block max-w-72 cursor-pointer truncate text-left text-xs text-muted-foreground underline-offset-2 hover:underline" title="View full details">
            {run.category === "issues" ? `${describeRun(run)}: ` : ""}
            {run.summary}
          </button>
        )
      },
    },
  ]

  return (
    <AdminPage
      title="Sync Logs"
      description="History of synchronisation runs per data source. Every Sync now appends a run; Details shows the failure reason or the issue list, never credentials."
    >
      <AdminToolbar activeCount={activeCount} onReset={reset}>
        <FilterSelect id="admin-logs-source" label="Data source" allLabel="All sources" value={source} onChange={setSource} options={dataSources.map((s) => ({ value: s.id, label: s.name }))} />
        <FilterSelect id="admin-logs-entity" label="Entity" allLabel="All entities" value={entity} onChange={setEntity} options={entityOptions} />
        <FilterSelect id="admin-logs-status" label="Status" allLabel="All" value={status} onChange={setStatus} options={syncStatusOptions} />
        <FilterSelect id="admin-logs-kind" label="Kind" allLabel="All kinds" value={kind} onChange={setKind} options={kindOptions} />
      </AdminToolbar>

      <AdminDataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        noun="run"
        defaultSort={{ key: "at", direction: "desc" }}
        rowActions={[{ label: "View details", icon: FileTextIcon, onSelect: (row) => setOpen(row) }]}
        emptyTitle="No sync runs match"
        emptyDescription="Adjust the filters to see other runs."
      />

      <Dialog open={open !== null} onOpenChange={(next) => { if (!next) setOpen(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{open ? `${dataSourceById.get(open.dataSourceId)?.name ?? open.dataSourceId} · ${formatDateTime(open.at)}` : "Run details"}</DialogTitle>
            <DialogDescription>
              {open && openRun ? `${openRun.status.toUpperCase()} · ${runCategoryLabel[openRun.category]} · ${describeRun(openRun)} · ${open.records} records in ${formatDuration(open.durationMs)}. Messages are redacted before they are stored; credentials never appear here.` : null}
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">{open?.error ?? "No details were recorded for this run."}</pre>
        </DialogContent>
      </Dialog>
    </AdminPage>
  )
}
