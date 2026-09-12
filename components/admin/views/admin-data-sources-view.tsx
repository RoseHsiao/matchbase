"use client"

import { PencilIcon } from "lucide-react"

import { useAdminCollection, useAdminNow } from "@/components/admin/admin-data-provider"
import { AdminDataTable, type AdminColumn } from "@/components/admin/admin-data-table"
import { AdminFormDialog } from "@/components/admin/admin-form-dialog"
import { AdminPage } from "@/components/admin/admin-page"
import { AdminStatusBadge } from "@/components/admin/admin-status-badge"
import { AdminToolbar } from "@/components/admin/admin-toolbar"
import { SelectField, TextField } from "@/components/admin/form-fields"
import { HierarchyFilterSelects, useHierarchyFilters } from "@/components/filters/hierarchy-filters"
import { useEntityEditor } from "@/components/admin/use-entity-editor"
import { CategoryBadge } from "@/components/category-badge"
import { FilterSelect } from "@/components/filters/filter-select"
import { dataSourceStatusOptions } from "@/lib/admin/status"
import type { DataSource, DataSourceStatus, Sport } from "@/lib/data/types"
import { formatRelativeTime } from "@/lib/format"
import { ALL } from "@/lib/schedule"
import { sportCategory, sportLabel, sports } from "@/lib/sports"

const NONE = "none"
type Draft = { name: string; sport: Sport | typeof NONE; status: DataSourceStatus }

export function AdminDataSourcesView() {
  const now = useAdminNow()
  const { items: dataSources, upsert } = useAdminCollection("dataSources")
  const { items: leagues } = useAdminCollection("leagues")
  const hierarchy = useHierarchyFilters({ category: ALL, sport: ALL, leagueId: ALL, status: ALL }, leagues)
  const { filters, update } = hierarchy
  const editor = useEntityEditor<Draft>({ name: "", sport: NONE, status: "connected" })

  const rows = dataSources.filter(
    (source) =>
      (filters.category === ALL || (source.sport !== undefined && sportCategory(source.sport) === filters.category)) &&
      (filters.sport === ALL || source.sport === filters.sport) &&
      (filters.status === ALL || source.status === filters.status)
  )

  const columns: AdminColumn<DataSource>[] = [
    { key: "name", header: "Source", cell: (row) => <span className="font-medium">{row.name}</span>, sortValue: (row) => row.name },
    { key: "category", header: "Category", cell: (row) => (row.sport ? <CategoryBadge category={sportCategory(row.sport)} /> : <span className="text-muted-foreground">All</span>) },
    { key: "sport", header: "Sport / Game", cell: (row) => (row.sport ? sportLabel(row.sport) : <span className="text-muted-foreground">Cross-discipline</span>), sortValue: (row) => (row.sport ? sportLabel(row.sport) : "") },
    { key: "status", header: "Status", cell: (row) => <AdminStatusBadge status={row.status} />, sortValue: (row) => row.status },
    { key: "synced", header: "Last synced", cell: (row) => (row.lastSyncedAt ? <time dateTime={row.lastSyncedAt}>{formatRelativeTime(row.lastSyncedAt, now)}</time> : "Never"), sortValue: (row) => row.lastSyncedAt ?? "", className: "whitespace-nowrap" },
  ]

  return (
    <AdminPage
      title="Data Sources"
      description="External feeds and manual imports that will populate the catalogue. Connections are placeholders until real integrations exist."
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
