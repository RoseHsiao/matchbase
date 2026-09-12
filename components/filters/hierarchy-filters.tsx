"use client"

import * as React from "react"

import { FilterSelect } from "@/components/filters/filter-select"
import type { League, Team } from "@/lib/data/types"
import {
  ALL,
  leaguesForFilters,
  reconcileHierarchy,
  sportsForCategory,
  teamsForFilters,
  type HierarchyFilters,
} from "@/lib/schedule"
import { categories, categoryLabel, sportLabel } from "@/lib/sports"

export type HierarchyFilterState = HierarchyFilters & { leagueId: string; teamId?: string }

/**
 * Filter state for Category → Sport/Game → League (→ Team), with narrowing
 * options and reconciliation. Extra fields on `T` pass through untouched.
 */
export function useHierarchyFilters<T extends HierarchyFilterState>(
  defaults: T,
  leagues: readonly League[],
  teams?: readonly Team[]
) {
  const [filters, setFilters] = React.useState<T>(defaults)

  function update(patch: Partial<T>) {
    setFilters((current) => reconcileHierarchy({ ...current, ...patch }, leagues, teams))
  }

  const activeCount = Object.entries(filters).filter(([key, value]) =>
    key === "query" ? String(value).trim() !== "" : value !== ALL
  ).length

  return {
    filters,
    update,
    reset: () => setFilters(defaults),
    activeCount,
    sportOptions: sportsForCategory(filters.category),
    leagueOptions: leaguesForFilters(leagues, filters),
    teamOptions: teams ? teamsForFilters(teams, leagues, filters) : [],
  }
}

type HierarchyFilterSelectsProps<T extends HierarchyFilterState> = {
  idPrefix: string
  filters: T
  update: (patch: Partial<T>) => void
  sportOptions: ReturnType<typeof sportsForCategory>
  leagueOptions: readonly League[]
  /** Pass team options to render a Team select as well. */
  teamOptions?: readonly Team[]
  /** Hide the League select, e.g. on the Leagues page itself. */
  showLeague?: boolean
}

/** Category, Sport/Game, League, and optional Team selects in that order. */
export function HierarchyFilterSelects<T extends HierarchyFilterState>({
  idPrefix,
  filters,
  update,
  sportOptions,
  leagueOptions,
  teamOptions,
  showLeague = true,
}: HierarchyFilterSelectsProps<T>) {
  return (
    <>
      <FilterSelect
        id={`${idPrefix}-category`}
        label="Category"
        allLabel="All"
        value={filters.category}
        onChange={(category) => update({ category } as Partial<T>)}
        options={categories.map((c) => ({ value: c, label: categoryLabel(c) }))}
      />
      <FilterSelect
        id={`${idPrefix}-sport`}
        label="Sport / Game"
        allLabel="All"
        value={filters.sport}
        onChange={(sport) => update({ sport } as Partial<T>)}
        options={sportOptions.map((s) => ({ value: s, label: sportLabel(s) }))}
      />
      {showLeague ? (
        <FilterSelect
          id={`${idPrefix}-league`}
          label="League"
          allLabel="All leagues"
          value={filters.leagueId}
          onChange={(leagueId) => update({ leagueId } as Partial<T>)}
          options={leagueOptions.map((l) => ({ value: l.id, label: l.name }))}
        />
      ) : null}
      {teamOptions ? (
        <FilterSelect
          id={`${idPrefix}-team`}
          label="Team"
          allLabel="All teams"
          value={filters.teamId ?? ALL}
          onChange={(teamId) => update({ teamId } as Partial<T>)}
          options={teamOptions.map((t) => ({ value: t.id, label: t.name }))}
        />
      ) : null}
    </>
  )
}
