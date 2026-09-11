"use client"

import { SearchIcon, XIcon } from "lucide-react"

import { FilterField } from "@/components/filters/filter-select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type AdminToolbarProps = {
  search?: {
    value: string
    onChange: (value: string) => void
    placeholder: string
    /** Used for the label id; defaults to "admin-search". */
    id?: string
  }
  /** Filter selects, usually built from FilterSelect. */
  children?: React.ReactNode
  activeCount: number
  onReset: () => void
}

/** Search, filters, and reset laid out the same way on every admin list page. */
export function AdminToolbar({ search, children, activeCount, onReset }: AdminToolbarProps) {
  const searchId = search?.id ?? "admin-search"
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
      {search ? (
        <FilterField id={searchId} label="Search">
          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              aria-labelledby={`${searchId}-label`}
              placeholder={search.placeholder}
              value={search.value}
              onChange={(event) => search.onChange(event.target.value)}
              className="pl-8 lg:w-64"
            />
          </div>
        </FilterField>
      ) : null}
      {children ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-end">
          {children}
        </div>
      ) : null}
      <Button
        variant="ghost"
        className="w-fit enabled:cursor-pointer"
        disabled={activeCount === 0}
        onClick={onReset}
      >
        <XIcon data-icon="inline-start" />
        Reset{activeCount > 0 ? ` (${activeCount})` : ""}
      </Button>
    </div>
  )
}
