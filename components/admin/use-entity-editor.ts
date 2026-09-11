"use client"

import * as React from "react"

/** Dialog + draft state shared by every admin create/edit form. */
export function useEntityEditor<D>(empty: D) {
  const [open, setOpen] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<D>(empty)

  return {
    open,
    setOpen,
    editingId,
    draft,
    patch: (patch: Partial<D>) => setDraft((current) => ({ ...current, ...patch })),
    openCreate() {
      setDraft(empty)
      setEditingId(null)
      setOpen(true)
    },
    openEdit(id: string, value: D) {
      setDraft(value)
      setEditingId(id)
      setOpen(true)
    },
    close: () => setOpen(false),
  }
}
