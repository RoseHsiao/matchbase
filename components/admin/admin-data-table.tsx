"use client"

import * as React from "react"
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  MoreHorizontalIcon,
  SearchXIcon,
  type LucideIcon,
} from "lucide-react"
import { cn } from "cn"

import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export type AdminColumn<T> = {
  key: string
  header: string
  cell: (row: T) => React.ReactNode
  /** Enables sorting on this column. */
  sortValue?: (row: T) => string | number
  className?: string
}

export type AdminRowAction<T> = {
  label: string
  onSelect: (row: T) => void
  icon?: LucideIcon
  destructive?: boolean
}

type SortState = { key: string; direction: "asc" | "desc" }

type AdminDataTableProps<T> = {
  columns: AdminColumn<T>[]
  rows: T[]
  getRowId: (row: T) => string
  rowActions?: AdminRowAction<T>[]
  defaultSort?: SortState
  pageSize?: number
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: React.ReactNode
  /** Singular noun for the footer, e.g. "team". */
  noun?: string
  /** Plural form when it is not just `noun + "s"`, e.g. "matches". */
  nounPlural?: string
}

/**
 * Sortable, paginated table shared by every admin list. Search and filters
 * happen outside; this component receives the already-filtered rows.
 */
export function AdminDataTable<T>({
  columns,
  rows,
  getRowId,
  rowActions,
  defaultSort,
  pageSize = 10,
  emptyTitle = "Nothing here yet",
  emptyDescription,
  emptyAction,
  noun = "row",
  nounPlural = `${noun}s`,
}: AdminDataTableProps<T>) {
  const [sort, setSort] = React.useState<SortState | undefined>(defaultSort)
  const [page, setPage] = React.useState(0)

  const sorted = React.useMemo(() => {
    if (!sort) return rows
    const column = columns.find((c) => c.key === sort.key)
    if (!column?.sortValue) return rows
    const value = column.sortValue
    const factor = sort.direction === "asc" ? 1 : -1
    return [...rows].sort((a, b) => {
      const av = value(a)
      const bv = value(b)
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor
      return String(av).localeCompare(String(bv)) * factor
    })
  }, [rows, columns, sort])

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const start = safePage * pageSize
  const visible = sorted.slice(start, start + pageSize)

  function toggleSort(key: string) {
    setPage(0)
    setSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" }
    )
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={SearchXIcon}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
        className="py-12"
      />
    )
  }

  return (
    <Card className="gap-0 py-0">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => {
              const active = sort?.key === column.key
              const SortIcon = !active
                ? ArrowUpDownIcon
                : sort.direction === "asc"
                  ? ArrowUpIcon
                  : ArrowDownIcon
              return (
                <TableHead
                  key={column.key}
                  className={cn("whitespace-nowrap", column.className)}
                  aria-sort={
                    active ? (sort.direction === "asc" ? "ascending" : "descending") : undefined
                  }
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      {column.header}
                      <SortIcon
                        className={cn("size-3.5", !active && "text-muted-foreground/60")}
                        aria-hidden
                      />
                    </button>
                  ) : (
                    column.header
                  )}
                </TableHead>
              )
            })}
            {rowActions?.length ? (
              <TableHead className="w-10 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((row) => (
            <TableRow key={getRowId(row)}>
              {columns.map((column) => (
                <TableCell key={column.key} className={cn("align-middle", column.className)}>
                  {column.cell(row)}
                </TableCell>
              ))}
              {rowActions?.length ? (
                <TableCell className="text-right">
                  <RowActionsMenu row={row} actions={rowActions} />
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
        <span>
          Showing {start + 1}–{Math.min(start + pageSize, sorted.length)} of {sorted.length}{" "}
          {sorted.length === 1 ? noun : nounPlural}
        </span>
        <div className="flex items-center gap-2">
          <span className="tabular-nums">
            Page {safePage + 1} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="enabled:cursor-pointer"
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="enabled:cursor-pointer"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage(safePage + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </Card>
  )
}

function RowActionsMenu<T>({ row, actions }: { row: T; actions: AdminRowAction<T>[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Row actions"
            className="cursor-pointer"
          />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.label}
            variant={action.destructive ? "destructive" : "default"}
            className="cursor-pointer"
            onClick={() => action.onSelect(row)}
          >
            {action.icon ? <action.icon /> : null}
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
