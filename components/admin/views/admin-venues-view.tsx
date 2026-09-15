"use client"

import * as React from "react"
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"

import { useAdminCollection } from "@/components/admin/admin-data-provider"
import { AdminDataTable, type AdminColumn } from "@/components/admin/admin-data-table"
import { AdminDeleteDialog } from "@/components/admin/admin-delete-dialog"
import { AdminFormDialog } from "@/components/admin/admin-form-dialog"
import { AdminPage } from "@/components/admin/admin-page"
import { AdminStatusBadge } from "@/components/admin/admin-status-badge"
import { AdminToolbar } from "@/components/admin/admin-toolbar"
import { NumberField, SelectField, TextField } from "@/components/admin/form-fields"
import { useEntityEditor } from "@/components/admin/use-entity-editor"
import { FilterSelect } from "@/components/filters/filter-select"
import { Button } from "@/components/ui/button"
import { entityStatusOptions } from "@/lib/admin/status"
import { newId } from "@/lib/collection-store"
import type { EntityStatus, Venue } from "@/lib/data/types"
import { ALL } from "@/lib/schedule"

type Draft = { name: string; city: string; country: string; capacity: number | ""; status: EntityStatus }
const emptyDraft: Draft = { name: "", city: "", country: "", capacity: "", status: "active" }

export function AdminVenuesView() {
  const { items: venues, upsert, remove } = useAdminCollection("venues")
  const { items: matches } = useAdminCollection("matches")
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState<string>(ALL)
  const editor = useEntityEditor<Draft>(emptyDraft)
  const [deleting, setDeleting] = React.useState<Venue | null>(null)

  const needle = query.trim().toLowerCase()
  const rows = venues.filter(
    (venue) =>
      (status === ALL || venue.status === status) &&
      (!needle || [venue.name, venue.city, venue.country].some((v) => v.toLowerCase().includes(needle)))
  )
  const matchCount = (venue: Venue) => matches.filter((m) => m.venueId === venue.id).length
  const activeCount = (needle ? 1 : 0) + (status === ALL ? 0 : 1)

  const columns: AdminColumn<Venue>[] = [
    { key: "name", header: "Venue", cell: (row) => <span className="font-medium">{row.name}</span>, sortValue: (row) => row.name },
    { key: "city", header: "City", cell: (row) => row.city, sortValue: (row) => row.city },
    { key: "country", header: "Country", cell: (row) => row.country, sortValue: (row) => row.country },
    { key: "capacity", header: "Capacity", cell: (row) => (row.capacity ? row.capacity.toLocaleString("en-US") : "—"), sortValue: (row) => row.capacity ?? 0, className: "tabular-nums" },
    { key: "matches", header: "Matches", cell: (row) => matchCount(row), sortValue: (row) => matchCount(row), className: "tabular-nums" },
    { key: "status", header: "Status", cell: (row) => <AdminStatusBadge status={row.status} /> },
  ]

  function submit() {
    upsert({
      id: editor.editingId ?? newId("venue"),
      name: editor.draft.name.trim(),
      city: editor.draft.city.trim(),
      country: editor.draft.country.trim(),
      capacity: editor.draft.capacity === "" ? undefined : editor.draft.capacity,
      status: editor.draft.status,
    })
    editor.close()
  }

  return (
    <AdminPage
      title="Venues"
      description="Physical venues for traditional sports events. Esports matches can reference a studio or arena, but a venue is never required."
      actions={<Button className="cursor-pointer" onClick={editor.openCreate}><PlusIcon data-icon="inline-start" />Add venue</Button>}
    >
      <AdminToolbar
        search={{ id: "admin-venues-search", value: query, onChange: setQuery, placeholder: "Venue, city, or country" }}
        activeCount={activeCount}
        onReset={() => { setQuery(""); setStatus(ALL) }}
      >
        <FilterSelect id="admin-venues-status" label="Status" allLabel="All" value={status} onChange={setStatus} options={entityStatusOptions} />
      </AdminToolbar>

      <AdminDataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        noun="venue"
        defaultSort={{ key: "name", direction: "asc" }}
        rowActions={[
          { label: "Edit", icon: PencilIcon, onSelect: (row) => editor.openEdit(row.id, { name: row.name, city: row.city, country: row.country, capacity: row.capacity ?? "", status: row.status }) },
          { label: "Delete", icon: Trash2Icon, destructive: true, onSelect: setDeleting },
        ]}
        emptyTitle="No venues match"
        emptyAction={<Button variant="outline" size="sm" className="cursor-pointer" onClick={() => { setQuery(""); setStatus(ALL) }}>Reset filters</Button>}
      />

      <AdminFormDialog
        open={editor.open}
        onOpenChange={editor.setOpen}
        title={editor.editingId ? "Edit venue" : "Add venue"}
        submitLabel={editor.editingId ? "Save changes" : "Add venue"}
        onSubmit={submit}
      >
        <TextField id="venue-name" label="Name" value={editor.draft.name} onChange={(name) => editor.patch({ name })} required full />
        <TextField id="venue-city" label="City" value={editor.draft.city} onChange={(city) => editor.patch({ city })} required />
        <TextField id="venue-country" label="Country" value={editor.draft.country} onChange={(country) => editor.patch({ country })} required />
        <NumberField id="venue-capacity" label="Capacity" value={editor.draft.capacity} onChange={(capacity) => editor.patch({ capacity })} min={0} />
        <SelectField id="venue-status" label="Status" value={editor.draft.status} onChange={(status) => editor.patch({ status: status as EntityStatus })} options={entityStatusOptions} />
      </AdminFormDialog>

      <AdminDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null) }}
        name={deleting?.name ?? "venue"}
        description={deleting ? `${matchCount(deleting)} matches are at this venue; they will have no venue afterwards.` : undefined}
        onConfirm={() => { if (deleting) remove(deleting.id) }}
      />
    </AdminPage>
  )
}
