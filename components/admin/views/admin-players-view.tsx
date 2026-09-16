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
import { NumberField, SelectField, TextField } from "@/components/admin/form-fields"
import { HierarchyFilterSelects, useHierarchyFilters } from "@/components/filters/hierarchy-filters"
import { useEntityEditor } from "@/components/admin/use-entity-editor"
import { CategoryLine, SportLine } from "@/components/sport-icon"
import { FilterSelect } from "@/components/filters/filter-select"
import { PlayerAvatar } from "@/components/players/player-avatar"
import { Button } from "@/components/ui/button"
import { entityStatusOptions } from "@/lib/admin/status"
import { newId } from "@/lib/collection-store"
import type { EntityStatus, Player } from "@/lib/data/types"
import { playerDisplayName } from "@/lib/players"
import { ALL } from "@/lib/schedule"
import { sportCategory } from "@/lib/sports"

/** Select value for "no team"; the stored field is null (individual athletes). */
const NO_TEAM = "none"

type Draft = { name: string; handle: string; teamId: string; role: string; nationality: string; number: number | ""; status: EntityStatus }
const emptyDraft: Draft = { name: "", handle: "", teamId: NO_TEAM, role: "", nationality: "", number: "", status: "active" }

export function AdminPlayersView() {
  const { items: players, upsert, remove } = useAdminCollection("players")
  const { items: leagues } = useAdminCollection("leagues")
  const { items: teams } = useAdminCollection("teams")
  const { leagueById, teamById } = useAdminLookups()
  const hierarchy = useHierarchyFilters({ query: "", category: ALL, sport: ALL, leagueId: ALL, teamId: ALL, status: ALL }, leagues, teams)
  const { filters, update } = hierarchy
  const editor = useEntityEditor<Draft>(emptyDraft)
  const [deleting, setDeleting] = React.useState<Player | null>(null)

  const query = filters.query.trim().toLowerCase()
  const context = (player: Player) => {
    const team = player.teamId ? teamById.get(player.teamId) : undefined
    const league = team ? leagueById.get(team.leagueId) : undefined
    return { team, league }
  }
  // Players without a team have no league context here; they pass only unfiltered hierarchy levels.
  const rows = players.filter((player) => {
    const { team, league } = context(player)
    return (
      (filters.category === ALL || (league !== undefined && sportCategory(league.sport) === filters.category)) &&
      (filters.sport === ALL || league?.sport === filters.sport) &&
      (filters.leagueId === ALL || team?.leagueId === filters.leagueId) &&
      (filters.teamId === ALL || player.teamId === filters.teamId) &&
      (filters.status === ALL || (player.status ?? "active") === filters.status) &&
      (!query || [player.name, player.handle ?? ""].some((v) => v.toLowerCase().includes(query)))
    )
  })

  const columns: AdminColumn<Player>[] = [
    {
      key: "name",
      header: "Player",
      cell: (row) => (
        <span className="flex items-center gap-2">
          <PlayerAvatar player={row} size="sm" />
          <span className="grid leading-tight">
            <span className="font-medium">{playerDisplayName(row)}</span>
            <span className="text-xs text-muted-foreground">{row.handle ? `${row.name}${row.role ? ` · ${row.role}` : ""}` : row.role || "—"}</span>
          </span>
        </span>
      ),
      sortValue: (row) => playerDisplayName(row),
    },
    { key: "team", header: "Team", cell: (row) => context(row).team?.name ?? <span className="text-muted-foreground">Independent</span>, sortValue: (row) => context(row).team?.name ?? "" },
    { key: "category", header: "Category", cell: (row) => { const l = context(row).league; return l ? <CategoryLine category={sportCategory(l.sport)} size="sm" /> : "—" } },
    { key: "sport", header: "Sport / Game", cell: (row) => { const l = context(row).league; return l ? <SportLine sport={l.sport} /> : "—" } },
    { key: "league", header: "League", cell: (row) => context(row).league?.name ?? "—", sortValue: (row) => context(row).league?.name ?? "" },
    { key: "status", header: "Status", cell: (row) => <AdminStatusBadge status={row.status ?? "active"} /> },
  ]

  function submit() {
    upsert({
      id: editor.editingId ?? newId("player"),
      name: editor.draft.name.trim(),
      handle: editor.draft.handle.trim() || undefined,
      teamId: editor.draft.teamId === NO_TEAM ? undefined : editor.draft.teamId,
      role: editor.draft.role.trim(),
      nationality: editor.draft.nationality.trim() || undefined,
      number: editor.draft.number === "" ? undefined : editor.draft.number,
      status: editor.draft.status,
    })
    editor.close()
  }

  return (
    <AdminPage
      title="Players"
      description="Players and their current teams. Individual-sport athletes have no team. The same records power the user-facing Players pages."
      actions={<Button className="cursor-pointer" onClick={editor.openCreate}><PlusIcon data-icon="inline-start" />Add player</Button>}
    >
      <AdminToolbar
        search={{ id: "admin-players-search", value: filters.query, onChange: (query) => update({ query }), placeholder: "Player name or handle" }}
        activeCount={hierarchy.activeCount}
        onReset={hierarchy.reset}
      >
        <HierarchyFilterSelects idPrefix="admin-players" filters={filters} update={update} sportOptions={hierarchy.sportOptions} leagueOptions={hierarchy.leagueOptions} teamOptions={hierarchy.teamOptions} />
        <FilterSelect id="admin-players-status" label="Status" allLabel="All" value={filters.status} onChange={(status) => update({ status })} options={entityStatusOptions} />
      </AdminToolbar>

      <AdminDataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        noun="player"
        defaultSort={{ key: "name", direction: "asc" }}
        rowActions={[
          { label: "Edit", icon: PencilIcon, onSelect: (row) => editor.openEdit(row.id, { name: row.name, handle: row.handle ?? "", teamId: row.teamId ?? NO_TEAM, role: row.role, nationality: row.nationality ?? "", number: row.number ?? "", status: row.status ?? "active" }) },
          { label: "Delete", icon: Trash2Icon, destructive: true, onSelect: setDeleting },
        ]}
        emptyTitle="No players match"
        emptyDescription="Adjust the filters or add a player."
        emptyAction={<Button variant="outline" size="sm" className="cursor-pointer" onClick={hierarchy.reset}>Reset filters</Button>}
      />

      <AdminFormDialog
        open={editor.open}
        onOpenChange={editor.setOpen}
        title={editor.editingId ? "Edit player" : "Add player"}
        description="Category, sport, and league follow from the team. Leave the team empty for individual-sport athletes."
        submitLabel={editor.editingId ? "Save changes" : "Add player"}
        onSubmit={submit}
      >
        <TextField id="player-name" label="Full name" value={editor.draft.name} onChange={(name) => editor.patch({ name })} required />
        <TextField id="player-handle" label="Handle" value={editor.draft.handle} onChange={(handle) => editor.patch({ handle })} hint="In-game name for esports players." />
        <SelectField id="player-team" label="Team" value={editor.draft.teamId} onChange={(teamId) => editor.patch({ teamId })} options={[{ value: NO_TEAM, label: "No team (individual)" }, ...teams.map((t) => ({ value: t.id, label: `${t.name} · ${leagueById.get(t.leagueId)?.shortName ?? ""}` }))]} />
        <TextField id="player-role" label="Role / position" value={editor.draft.role} onChange={(role) => editor.patch({ role })} />
        <TextField id="player-nationality" label="Nationality" value={editor.draft.nationality} onChange={(nationality) => editor.patch({ nationality })} />
        <NumberField id="player-number" label="Squad number" value={editor.draft.number} onChange={(number) => editor.patch({ number })} min={0} hint="Traditional team sports only." />
        <SelectField id="player-status" label="Status" value={editor.draft.status} onChange={(status) => editor.patch({ status: status as EntityStatus })} options={entityStatusOptions} full />
      </AdminFormDialog>

      <AdminDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null) }}
        name={deleting ? playerDisplayName(deleting) : "player"}
        description="A player who has taken part in a match cannot be deleted; set the status to inactive instead."
        onConfirm={() => { if (deleting) remove(deleting.id) }}
      />
    </AdminPage>
  )
}
