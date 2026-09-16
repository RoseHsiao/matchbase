"use client"

import * as React from "react"
import { PencilIcon } from "lucide-react"

import { useAdminCollection } from "@/components/admin/admin-data-provider"
import { AdminDataTable, type AdminColumn } from "@/components/admin/admin-data-table"
import { AdminFormDialog } from "@/components/admin/admin-form-dialog"
import { AdminPage } from "@/components/admin/admin-page"
import { AdminStatusBadge } from "@/components/admin/admin-status-badge"
import { AdminToolbar } from "@/components/admin/admin-toolbar"
import { SelectField } from "@/components/admin/form-fields"
import { useEntityEditor } from "@/components/admin/use-entity-editor"
import { CategoryLine, SportLine } from "@/components/sport-icon"
import { FilterSelect } from "@/components/filters/filter-select"
import { entityStatusOptions } from "@/lib/admin/status"
import type { EntityStatus, SportRecord } from "@/lib/data/types"
import { ALL } from "@/lib/schedule"
import { categories, categoryLabel, sportCategory, sportLabel } from "@/lib/sports"

type Row = SportRecord & { leagueCount: number; teamCount: number; matchCount: number }

export function AdminSportsView() {
  const { items: sports, upsert } = useAdminCollection("sports")
  const { items: leagues } = useAdminCollection("leagues")
  const { items: teams } = useAdminCollection("teams")
  const { items: matches } = useAdminCollection("matches")
  const [category, setCategory] = React.useState<string>(ALL)
  const editor = useEntityEditor<{ status: EntityStatus }>({ status: "active" })

  const rows: Row[] = sports
    .filter((sport) => category === ALL || sportCategory(sport.id) === category)
    .map((sport) => {
      const leagueIds = new Set(leagues.filter((l) => l.sport === sport.id).map((l) => l.id))
      return {
        ...sport,
        leagueCount: leagueIds.size,
        teamCount: teams.filter((t) => leagueIds.has(t.leagueId)).length,
        matchCount: matches.filter((m) => leagueIds.has(m.leagueId)).length,
      }
    })

  const columns: AdminColumn<Row>[] = [
    {
      key: "category",
      header: "Category",
      cell: (row) => <CategoryLine category={sportCategory(row.id)} size="sm" />,
      // Registry order (Sports, then Esports) rather than alphabetical.
      sortValue: (row) => categories.indexOf(sportCategory(row.id)),
    },
    {
      key: "sport",
      header: "Sport / Game",
      cell: (row) => <SportLine sport={row.id} className="font-medium" />,
      sortValue: (row) => sportLabel(row.id),
    },
    {
      key: "code",
      header: "Code",
      cell: (row) => <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{row.id}</code>,
      sortValue: (row) => row.id,
    },
    { key: "status", header: "Status", cell: (row) => <AdminStatusBadge status={row.status} /> },
    {
      key: "leagues",
      header: "Leagues",
      cell: (row) => `${row.leagueCount} ${row.leagueCount === 1 ? "league" : "leagues"}`,
      sortValue: (row) => row.leagueCount,
    },
    {
      key: "teams",
      header: "Teams",
      cell: (row) => row.teamCount,
      sortValue: (row) => row.teamCount,
      className: "tabular-nums",
    },
    {
      key: "matches",
      header: "Matches",
      cell: (row) => row.matchCount,
      sortValue: (row) => row.matchCount,
      className: "tabular-nums",
    },
  ]

  return (
    <AdminPage
      title="Sports & Games"
      description="The top level of the catalogue, derived from the code-level registry in lib/sports.ts. Sports and Esports are parallel categories; each sport or game belongs to exactly one."
    >
      <AdminToolbar activeCount={category === ALL ? 0 : 1} onReset={() => setCategory(ALL)}>
        <FilterSelect
          id="admin-sports-category"
          label="Category"
          allLabel="All"
          value={category}
          onChange={setCategory}
          options={categories.map((c) => ({ value: c, label: categoryLabel(c) }))}
        />
      </AdminToolbar>

      <AdminDataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        noun="sport"
        defaultSort={{ key: "category", direction: "asc" }}
        rowActions={[
          {
            label: "Edit status",
            icon: PencilIcon,
            onSelect: (row) => editor.openEdit(row.id, { status: row.status }),
          },
        ]}
        emptyTitle="No sports or games match"
      />

      <AdminFormDialog
        open={editor.open}
        onOpenChange={editor.setOpen}
        title={editor.editingId ? `Edit ${sportLabel(editor.editingId as SportRecord["id"])}` : "Edit"}
        description="The catalogue of sports and games is defined in code; only the status can be changed here."
        onSubmit={() => {
          if (editor.editingId) {
            upsert({ id: editor.editingId as SportRecord["id"], status: editor.draft.status })
          }
          editor.close()
        }}
      >
        <SelectField
          id="sport-status"
          label="Status"
          value={editor.draft.status}
          onChange={(status) => editor.patch({ status: status as EntityStatus })}
          options={entityStatusOptions}
          full
        />
      </AdminFormDialog>
    </AdminPage>
  )
}
