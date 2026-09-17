"use client"

import { SearchIcon, SearchXIcon, XIcon } from "lucide-react"
import { cn } from "cn"

import { HierarchyGroups } from "@/components/collection/hierarchy-groups"
import { EmptyState } from "@/components/empty-state"
import { FilterField } from "@/components/filters/filter-select"
import {
  HierarchyFilterSelects,
  type HierarchyController,
  type HierarchyFilterState,
} from "@/components/filters/hierarchy-filters"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { GroupedCollection } from "@/lib/hierarchy"

type Noun = { one: string; other: string }

type CollectionBrowserProps<T, F extends HierarchyFilterState & { query: string }> = {
  idPrefix: string
  searchPlaceholder: string
  /** From `useHierarchyFilters`; the browser renders its toolbar and reset. */
  hierarchy: HierarchyController<F>
  /** Render the Team select (Players). Teams have no narrower level. */
  showTeamFilter?: boolean
  /** The filtered collection, already grouped by lib/hierarchy.ts. */
  grouped: GroupedCollection<T>
  /** How many visible items the user follows, for the summary line. */
  followedCount: number
  noun: Noun
  itemKey: (item: T) => string
  renderItem: (item: T) => React.ReactNode
  emptyTitle: string
}

/**
 * Search + Category → Sport/Game → League (→ Team) toolbar, a summary line,
 * and the grouped collection. Shared by the Teams and Players pages so both
 * browse the same way; the pages only decide what an item is and how it
 * renders.
 */
export function CollectionBrowser<T, F extends HierarchyFilterState & { query: string }>({
  idPrefix,
  searchPlaceholder,
  hierarchy,
  showTeamFilter = false,
  grouped,
  followedCount,
  noun,
  itemKey,
  renderItem,
  emptyTitle,
}: CollectionBrowserProps<T, F>) {
  const { filters, update, reset, activeCount } = hierarchy
  const query = filters.query.trim()
  const total = grouped.total

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <FilterField id={`${idPrefix}-search`} label="Search">
          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              aria-labelledby={`${idPrefix}-search-label`}
              placeholder={searchPlaceholder}
              value={filters.query}
              onChange={(event) => update({ query: event.target.value } as Partial<F>)}
              className="pl-8 lg:w-64"
            />
          </div>
        </FilterField>

        <div
          className={cn(
            "grid grid-cols-2 gap-3 lg:flex lg:flex-wrap lg:items-end",
            showTeamFilter ? "sm:grid-cols-4" : "sm:grid-cols-3"
          )}
        >
          <HierarchyFilterSelects
            idPrefix={idPrefix}
            filters={filters}
            update={update}
            sportOptions={hierarchy.sportOptions}
            leagueOptions={hierarchy.leagueOptions}
            teamOptions={showTeamFilter ? hierarchy.teamOptions : undefined}
          />
        </div>

        <Button
          variant="ghost"
          className="w-fit"
          disabled={activeCount === 0}
          onClick={reset}
        >
          <XIcon data-icon="inline-start" />
          Reset{activeCount > 0 ? ` (${activeCount})` : ""}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {total} {total === 1 ? noun.one : noun.other}
        {followedCount > 0 ? ` · following ${followedCount}` : ""}
      </p>

      {total > 0 ? (
        <HierarchyGroups grouped={grouped} itemKey={itemKey} renderItem={renderItem} noun={noun} />
      ) : (
        <EmptyState
          icon={SearchXIcon}
          title={emptyTitle}
          description={
            query
              ? `Nothing matches "${query}" with the current filters.`
              : "Nothing matches the current filters."
          }
          action={
            <Button variant="outline" size="sm" onClick={reset}>
              Reset filters
            </Button>
          }
          className="py-12"
        />
      )}
    </div>
  )
}
