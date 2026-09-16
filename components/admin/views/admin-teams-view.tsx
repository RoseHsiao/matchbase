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
import { SelectField, TextField } from "@/components/admin/form-fields"
import { HierarchyFilterSelects, useHierarchyFilters } from "@/components/filters/hierarchy-filters"
import { useEntityEditor } from "@/components/admin/use-entity-editor"
import { CategoryLine, SportLine } from "@/components/sport-icon"
import { FilterSelect } from "@/components/filters/filter-select"
import { TeamLogo } from "@/components/matches/team-logo"
import { Button } from "@/components/ui/button"
import { entityStatusOptions } from "@/lib/admin/status"
import { newId } from "@/lib/collection-store"
import type { EntityStatus, Team } from "@/lib/data/types"
import { ALL } from "@/lib/schedule"
import { sportCategory, sportLabel } from "@/lib/sports"

type Draft = { name: string; shortName: string; code: string; leagueId: string; color: string; status: EntityStatus }
const emptyDraft: Draft = { name: "", shortName: "", code: "", leagueId: "", color: "#334155", status: "active" }

export function AdminTeamsView() {
  const { items: teams, upsert, remove } = useAdminCollection("teams")
  const { items: leagues } = useAdminCollection("leagues")
  const { items: players } = useAdminCollection("players")
  const { leagueById } = useAdminLookups()
  const hierarchy = useHierarchyFilters({ query: "", category: ALL, sport: ALL, leagueId: ALL, status: ALL }, leagues)
  const { filters, update } = hierarchy
  const editor = useEntityEditor<Draft>(emptyDraft)
  const [deleting, setDeleting] = React.useState<Team | null>(null)

  const query = filters.query.trim().toLowerCase()
  const rows = teams.filter((team) => {
    const league = leagueById.get(team.leagueId)
    if (!league) return false
    return (
      (filters.category === ALL || sportCategory(league.sport) === filters.category) &&
      (filters.sport === ALL || league.sport === filters.sport) &&
      (filters.leagueId === ALL || team.leagueId === filters.leagueId) &&
      (filters.status === ALL || (team.status ?? "active") === filters.status) &&
      (!query || [team.name, team.shortName, team.code].some((v) => v.toLowerCase().includes(query)))
    )
  })
  const playerCount = (teamId: string) => players.filter((p) => p.teamId === teamId).length
  const leagueOf = (team: Team) => leagueById.get(team.leagueId)

  const columns: AdminColumn<Team>[] = [
    {
      key: "name",
      header: "Team",
      cell: (row) => (
        <span className="flex items-center gap-2">
          <TeamLogo team={row} size="sm" />
          <span className="grid leading-tight">
            <span className="font-medium">{row.name}</span>
            <span className="text-xs text-muted-foreground">{row.code}</span>
          </span>
        </span>
      ),
      sortValue: (row) => row.name,
    },
    { key: "category", header: "Category", cell: (row) => { const l = leagueOf(row); return l ? <CategoryLine category={sportCategory(l.sport)} size="sm" /> : "—" }, sortValue: (row) => { const l = leagueOf(row); return l ? sportCategory(l.sport) : "" } },
    { key: "sport", header: "Sport / Game", cell: (row) => { const l = leagueOf(row); return l ? <SportLine sport={l.sport} /> : "—" }, sortValue: (row) => { const l = leagueOf(row); return l ? sportLabel(l.sport) : "" } },
    { key: "league", header: "League", cell: (row) => leagueOf(row)?.name ?? "—", sortValue: (row) => leagueOf(row)?.name ?? "" },
    { key: "status", header: "Status", cell: (row) => <AdminStatusBadge status={row.status ?? "active"} /> },
    { key: "players", header: "Players", cell: (row) => playerCount(row.id), sortValue: (row) => playerCount(row.id), className: "tabular-nums" },
  ]

  function submit() {
    if (!editor.draft.leagueId) return
    const name = editor.draft.name.trim()
    upsert({
      id: editor.editingId ?? newId("team"),
      name,
      shortName: editor.draft.shortName.trim() || name,
      code: (editor.draft.code.trim() || name.slice(0, 3)).toUpperCase(),
      leagueId: editor.draft.leagueId,
      color: editor.draft.color,
      status: editor.draft.status,
    })
    editor.close()
  }

  return (
    <AdminPage
      title="Teams"
      description="Every team across sports and esports. The same records power the user-facing Teams pages."
      actions={<Button className="cursor-pointer" onClick={editor.openCreate}><PlusIcon data-icon="inline-start" />Add team</Button>}
    >
      <AdminToolbar
        search={{ id: "admin-teams-search", value: filters.query, onChange: (query) => update({ query }), placeholder: "Team name or code" }}
        activeCount={hierarchy.activeCount}
        onReset={hierarchy.reset}
      >
        <HierarchyFilterSelects idPrefix="admin-teams" filters={filters} update={update} sportOptions={hierarchy.sportOptions} leagueOptions={hierarchy.leagueOptions} />
        <FilterSelect id="admin-teams-status" label="Status" allLabel="All" value={filters.status} onChange={(status) => update({ status })} options={entityStatusOptions} />
      </AdminToolbar>

      <AdminDataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        noun="team"
        defaultSort={{ key: "name", direction: "asc" }}
        rowActions={[
          { label: "Edit", icon: PencilIcon, onSelect: (row) => editor.openEdit(row.id, { name: row.name, shortName: row.shortName, code: row.code, leagueId: row.leagueId, color: row.color, status: row.status ?? "active" }) },
          { label: "Delete", icon: Trash2Icon, destructive: true, onSelect: setDeleting },
        ]}
        emptyTitle="No teams match"
        emptyDescription="Adjust the filters or add a team."
        emptyAction={<Button variant="outline" size="sm" className="cursor-pointer" onClick={hierarchy.reset}>Reset filters</Button>}
      />

      <AdminFormDialog
        open={editor.open}
        onOpenChange={editor.setOpen}
        title={editor.editingId ? "Edit team" : "Add team"}
        description="Category and sport follow from the league."
        submitLabel={editor.editingId ? "Save changes" : "Add team"}
        onSubmit={submit}
      >
        <TextField id="team-name" label="Name" value={editor.draft.name} onChange={(name) => editor.patch({ name })} required full />
        <TextField id="team-short" label="Short name" value={editor.draft.shortName} onChange={(shortName) => editor.patch({ shortName })} />
        <TextField id="team-code" label="Code" value={editor.draft.code} onChange={(code) => editor.patch({ code })} placeholder="e.g. LAL" hint="Up to three letters for the logo placeholder." />
        <SelectField id="team-league" label="League" value={editor.draft.leagueId} onChange={(leagueId) => editor.patch({ leagueId })} options={leagues.map((l) => ({ value: l.id, label: `${l.name} · ${sportLabel(l.sport)}` }))} />
        <TextField id="team-color" label="Brand colour" type="color" value={editor.draft.color} onChange={(color) => editor.patch({ color })} />
        <SelectField id="team-status" label="Status" value={editor.draft.status} onChange={(status) => editor.patch({ status: status as EntityStatus })} options={entityStatusOptions} full />
      </AdminFormDialog>

      <AdminDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null) }}
        name={deleting?.name ?? "team"}
        description={deleting ? `${playerCount(deleting.id)} players are on this team. A team with players or matches cannot be deleted until they are reassigned or removed.` : undefined}
        onConfirm={() => { if (deleting) remove(deleting.id) }}
      />
    </AdminPage>
  )
}
