"use client"

import * as React from "react"
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"

import { useAdminCollection, useAdminLookups } from "@/components/admin/admin-data-provider"
import { AdminDataTable, type AdminColumn } from "@/components/admin/admin-data-table"
import { AdminDeleteDialog } from "@/components/admin/admin-delete-dialog"
import { AdminFormDialog } from "@/components/admin/admin-form-dialog"
import { AdminPage } from "@/components/admin/admin-page"
import { AdminStatusBadge } from "@/components/admin/admin-status-badge"
import { AdminToolbar } from "@/components/admin/admin-toolbar"
import { DateField, SelectField, TextField } from "@/components/admin/form-fields"
import { HierarchyFilterSelects, useHierarchyFilters } from "@/components/admin/hierarchy-filters"
import { useEntityEditor } from "@/components/admin/use-entity-editor"
import { CategoryBadge } from "@/components/category-badge"
import { FilterSelect } from "@/components/filters/filter-select"
import { Button } from "@/components/ui/button"
import { seasonStatusOptions } from "@/lib/admin/status"
import { newId } from "@/lib/collection-store"
import type { Season, SeasonStatus } from "@/lib/data/types"
import { formatDate } from "@/lib/format"
import { ALL } from "@/lib/schedule"
import { sportCategory, sportLabel } from "@/lib/sports"

type Draft = { name: string; leagueId: string; startsAt: string; endsAt: string; status: SeasonStatus }
const emptyDraft: Draft = { name: "", leagueId: "", startsAt: "", endsAt: "", status: "upcoming" }

export function AdminSeasonsView() {
  const { items: seasons, upsert, remove } = useAdminCollection("seasons")
  const { items: leagues } = useAdminCollection("leagues")
  const { leagueById } = useAdminLookups()
  const hierarchy = useHierarchyFilters({ category: ALL, sport: ALL, leagueId: ALL, status: ALL }, leagues)
  const { filters, update } = hierarchy
  const editor = useEntityEditor<Draft>(emptyDraft)
  const [deleting, setDeleting] = React.useState<Season | null>(null)

  const rows = seasons.filter((season) => {
    const league = leagueById.get(season.leagueId)
    if (!league) return false
    return (
      (filters.category === ALL || sportCategory(league.sport) === filters.category) &&
      (filters.sport === ALL || league.sport === filters.sport) &&
      (filters.leagueId === ALL || season.leagueId === filters.leagueId) &&
      (filters.status === ALL || season.status === filters.status)
    )
  })

  const leagueOf = (row: Season) => leagueById.get(row.leagueId)
  const columns: AdminColumn<Season>[] = [
    { key: "name", header: "Season", cell: (row) => <span className="font-medium">{row.name}</span>, sortValue: (row) => row.name },
    { key: "league", header: "League", cell: (row) => leagueOf(row)?.name ?? "—", sortValue: (row) => leagueOf(row)?.name ?? "" },
    { key: "sport", header: "Sport / Game", cell: (row) => { const l = leagueOf(row); return l ? sportLabel(l.sport) : "—" } },
    { key: "category", header: "Category", cell: (row) => { const l = leagueOf(row); return l ? <CategoryBadge category={sportCategory(l.sport)} /> : "—" } },
    { key: "start", header: "Start", cell: (row) => <time dateTime={row.startsAt}>{formatDate(row.startsAt)}</time>, sortValue: (row) => row.startsAt, className: "whitespace-nowrap" },
    { key: "end", header: "End", cell: (row) => <time dateTime={row.endsAt}>{formatDate(row.endsAt)}</time>, sortValue: (row) => row.endsAt, className: "whitespace-nowrap" },
    { key: "status", header: "Status", cell: (row) => <AdminStatusBadge status={row.status} /> },
  ]

  function submit() {
    if (!editor.draft.leagueId || !editor.draft.startsAt || !editor.draft.endsAt) return
    upsert({
      id: editor.editingId ?? newId("season"),
      name: editor.draft.name.trim(),
      leagueId: editor.draft.leagueId,
      startsAt: editor.draft.startsAt,
      endsAt: editor.draft.endsAt,
      status: editor.draft.status,
    })
    editor.close()
  }

  return (
    <AdminPage
      title="Seasons"
      description="Season windows for every league, across sports and esports."
      actions={<Button className="cursor-pointer" onClick={editor.openCreate}><PlusIcon data-icon="inline-start" />Add season</Button>}
    >
      <AdminToolbar activeCount={hierarchy.activeCount} onReset={hierarchy.reset}>
        <HierarchyFilterSelects idPrefix="admin-seasons" filters={filters} update={update} sportOptions={hierarchy.sportOptions} leagueOptions={hierarchy.leagueOptions} />
        <FilterSelect id="admin-seasons-status" label="Status" allLabel="All" value={filters.status} onChange={(status) => update({ status })} options={seasonStatusOptions} />
      </AdminToolbar>

      <AdminDataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        noun="season"
        defaultSort={{ key: "start", direction: "desc" }}
        rowActions={[
          { label: "Edit", icon: PencilIcon, onSelect: (row) => editor.openEdit(row.id, { name: row.name, leagueId: row.leagueId, startsAt: row.startsAt, endsAt: row.endsAt, status: row.status }) },
          { label: "Delete", icon: Trash2Icon, destructive: true, onSelect: setDeleting },
        ]}
        emptyTitle="No seasons match"
        emptyAction={<Button variant="outline" size="sm" className="cursor-pointer" onClick={hierarchy.reset}>Reset filters</Button>}
      />

      <AdminFormDialog
        open={editor.open}
        onOpenChange={editor.setOpen}
        title={editor.editingId ? "Edit season" : "Add season"}
        submitLabel={editor.editingId ? "Save changes" : "Add season"}
        onSubmit={submit}
      >
        <TextField id="season-name" label="Name" value={editor.draft.name} onChange={(name) => editor.patch({ name })} placeholder="e.g. 2026-27" required />
        <SelectField id="season-league" label="League" value={editor.draft.leagueId} onChange={(leagueId) => editor.patch({ leagueId })} options={leagues.map((l) => ({ value: l.id, label: `${l.name} · ${sportLabel(l.sport)}` }))} />
        <DateField id="season-start" label="Start date" value={editor.draft.startsAt} onChange={(startsAt) => editor.patch({ startsAt })} />
        <DateField id="season-end" label="End date" value={editor.draft.endsAt} onChange={(endsAt) => editor.patch({ endsAt })} />
        <SelectField id="season-status" label="Status" value={editor.draft.status} onChange={(status) => editor.patch({ status: status as SeasonStatus })} options={seasonStatusOptions} full />
      </AdminFormDialog>

      <AdminDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null) }}
        name={deleting ? `${leagueOf(deleting)?.name ?? ""} ${deleting.name}`.trim() : "season"}
        onConfirm={() => { if (deleting) remove(deleting.id) }}
      />
    </AdminPage>
  )
}
