"use client"

import * as React from "react"
import Link from "next/link"
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"

import { useAdminCollection } from "@/components/admin/admin-data-provider"
import { AdminDataTable, type AdminColumn } from "@/components/admin/admin-data-table"
import { AdminDeleteDialog } from "@/components/admin/admin-delete-dialog"
import { AdminFormDialog } from "@/components/admin/admin-form-dialog"
import { AdminPage } from "@/components/admin/admin-page"
import { AdminStatusBadge } from "@/components/admin/admin-status-badge"
import { AdminToolbar } from "@/components/admin/admin-toolbar"
import { SelectField, TextField } from "@/components/admin/form-fields"
import { HierarchyFilterSelects, useHierarchyFilters } from "@/components/filters/hierarchy-filters"
import { useEntityEditor } from "@/components/admin/use-entity-editor"
import { CategoryBadge } from "@/components/category-badge"
import { FilterSelect } from "@/components/filters/filter-select"
import { Button } from "@/components/ui/button"
import { entityStatusOptions } from "@/lib/admin/status"
import { newId } from "@/lib/collection-store"
import type { EntityStatus, League, Sport } from "@/lib/data/types"
import { ALL } from "@/lib/schedule"
import { categoryLabel, sportCategory, sportLabel, sports } from "@/lib/sports"

type Draft = {
  name: string
  shortName: string
  sport: Sport | ""
  region: string
  season: string
  status: EntityStatus
}

const emptyDraft: Draft = { name: "", shortName: "", sport: "", region: "", season: "", status: "active" }

export function AdminLeaguesView() {
  const { items: leagues, upsert, remove } = useAdminCollection("leagues")
  const { items: teams } = useAdminCollection("teams")
  const hierarchy = useHierarchyFilters(
    { query: "", category: ALL, sport: ALL, leagueId: ALL, status: ALL },
    leagues
  )
  const { filters, update } = hierarchy
  const editor = useEntityEditor<Draft>(emptyDraft)
  const [deleting, setDeleting] = React.useState<League | null>(null)

  const query = filters.query.trim().toLowerCase()
  const rows = leagues.filter(
    (league) =>
      (filters.category === ALL || sportCategory(league.sport) === filters.category) &&
      (filters.sport === ALL || league.sport === filters.sport) &&
      (filters.status === ALL || (league.status ?? "active") === filters.status) &&
      (!query ||
        league.name.toLowerCase().includes(query) ||
        league.shortName.toLowerCase().includes(query))
  )
  const teamCount = (leagueId: string) => teams.filter((t) => t.leagueId === leagueId).length

  const columns: AdminColumn<League>[] = [
    {
      key: "name",
      header: "League",
      cell: (row) => (
        <span className="grid leading-tight">
          <Link
            href={`/leagues/${row.id}`}
            className="w-fit font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {row.name}
          </Link>
          <span className="text-xs text-muted-foreground">{row.shortName} · {row.region}</span>
        </span>
      ),
      sortValue: (row) => row.name,
    },
    {
      key: "category",
      header: "Category",
      cell: (row) => <CategoryBadge category={sportCategory(row.sport)} />,
      sortValue: (row) => sportCategory(row.sport),
    },
    { key: "sport", header: "Sport / Game", cell: (row) => sportLabel(row.sport), sortValue: (row) => sportLabel(row.sport) },
    { key: "season", header: "Season", cell: (row) => row.season, sortValue: (row) => row.season },
    { key: "teams", header: "Teams", cell: (row) => teamCount(row.id), sortValue: (row) => teamCount(row.id), className: "tabular-nums" },
    { key: "status", header: "Status", cell: (row) => <AdminStatusBadge status={row.status ?? "active"} /> },
  ]

  function submit() {
    if (!editor.draft.sport) return
    upsert({
      id: editor.editingId ?? newId("league"),
      name: editor.draft.name.trim(),
      shortName: editor.draft.shortName.trim() || editor.draft.name.trim(),
      sport: editor.draft.sport,
      region: editor.draft.region.trim(),
      season: editor.draft.season.trim(),
      status: editor.draft.status,
    })
    editor.close()
  }

  return (
    <AdminPage
      title="Leagues"
      description="Competitions within each sport or game. The category is derived from the sport, so the hierarchy stays consistent."
      actions={
        <Button className="cursor-pointer" onClick={editor.openCreate}>
          <PlusIcon data-icon="inline-start" />
          Add league
        </Button>
      }
    >
      <AdminToolbar
        search={{ id: "admin-leagues-search", value: filters.query, onChange: (query) => update({ query }), placeholder: "League name or code" }}
        activeCount={hierarchy.activeCount}
        onReset={hierarchy.reset}
      >
        <HierarchyFilterSelects idPrefix="admin-leagues" filters={filters} update={update} sportOptions={hierarchy.sportOptions} leagueOptions={hierarchy.leagueOptions} showLeague={false} />
        <FilterSelect id="admin-leagues-status" label="Status" allLabel="All" value={filters.status} onChange={(status) => update({ status })} options={entityStatusOptions} />
      </AdminToolbar>

      <AdminDataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        noun="league"
        defaultSort={{ key: "name", direction: "asc" }}
        rowActions={[
          { label: "Edit", icon: PencilIcon, onSelect: (row) => editor.openEdit(row.id, { name: row.name, shortName: row.shortName, sport: row.sport, region: row.region, season: row.season, status: row.status ?? "active" }) },
          { label: "Delete", icon: Trash2Icon, destructive: true, onSelect: setDeleting },
        ]}
        emptyTitle="No leagues match"
        emptyDescription="Adjust the filters or add a league."
        emptyAction={<Button variant="outline" size="sm" className="cursor-pointer" onClick={hierarchy.reset}>Reset filters</Button>}
      />

      <AdminFormDialog
        open={editor.open}
        onOpenChange={editor.setOpen}
        title={editor.editingId ? "Edit league" : "Add league"}
        description={editor.draft.sport ? `Category: ${categoryLabel(sportCategory(editor.draft.sport))}` : "Category is derived from the sport or game."}
        submitLabel={editor.editingId ? "Save changes" : "Add league"}
        onSubmit={submit}
      >
        <TextField id="league-name" label="Name" value={editor.draft.name} onChange={(name) => editor.patch({ name })} required />
        <TextField id="league-short" label="Short name" value={editor.draft.shortName} onChange={(shortName) => editor.patch({ shortName })} placeholder="e.g. NBA" />
        <SelectField id="league-sport" label="Sport / Game" value={editor.draft.sport} onChange={(sport) => editor.patch({ sport: sport as Sport })} options={sports.map((s) => ({ value: s, label: `${sportLabel(s)} · ${categoryLabel(sportCategory(s))}` }))} />
        <TextField id="league-region" label="Region" value={editor.draft.region} onChange={(region) => editor.patch({ region })} />
        <TextField id="league-season" label="Current season" value={editor.draft.season} onChange={(season) => editor.patch({ season })} placeholder="e.g. 2026-27" />
        <SelectField id="league-status" label="Status" value={editor.draft.status} onChange={(status) => editor.patch({ status: status as EntityStatus })} options={entityStatusOptions} />
      </AdminFormDialog>

      <AdminDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null) }}
        name={deleting?.name ?? "league"}
        description={deleting ? `${teamCount(deleting.id)} teams reference this league. They will keep their league id until reassigned.` : undefined}
        onConfirm={() => { if (deleting) remove(deleting.id) }}
      />
    </AdminPage>
  )
}
