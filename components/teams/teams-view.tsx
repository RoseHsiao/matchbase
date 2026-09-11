"use client"

import * as React from "react"
import { SearchIcon, SearchXIcon, XIcon } from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { FilterField, FilterSelect } from "@/components/filters/filter-select"
import { TeamCard } from "@/components/teams/team-card"
import { useFollows } from "@/components/teams/follows-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { League, TeamView } from "@/lib/data/types"
import { leaguesForFilters, sportsForCategory } from "@/lib/schedule"
import { categories, categoryLabel, sportLabel } from "@/lib/sports"
import {
  countActiveTeamFilters,
  defaultTeamFilters,
  filterTeams,
  reconcileTeamFilters,
  type TeamFilterState,
} from "@/lib/teams"

type TeamsViewProps = {
  teams: TeamView[]
  leagues: League[]
}

/** Client-side search and filters over a preloaded team list. */
export function TeamsView({ teams, leagues }: TeamsViewProps) {
  const [filters, setFilters] = React.useState<TeamFilterState>(defaultTeamFilters)
  const { ids: followedIds } = useFollows()

  const visible = filterTeams(teams, filters)
  const followedVisible = visible.filter((team) => followedIds.has(team.id)).length
  const activeCount = countActiveTeamFilters(filters)
  const sportOptions = sportsForCategory(filters.category)
  const leagueOptions = leaguesForFilters(leagues, filters)

  function update(patch: Partial<TeamFilterState>) {
    setFilters((current) => reconcileTeamFilters({ ...current, ...patch }, leagues))
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <FilterField id="teams-search" label="Search">
          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              aria-labelledby="teams-search-label"
              placeholder="Team name or abbreviation"
              value={filters.query}
              onChange={(event) => update({ query: event.target.value })}
              className="pl-8 lg:w-72"
            />
          </div>
        </FilterField>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:flex lg:items-end">
          <FilterSelect
            id="teams-category"
            label="Category"
            allLabel="All"
            value={filters.category}
            onChange={(category) =>
              update({ category: category as TeamFilterState["category"] })
            }
            options={categories.map((category) => ({
              value: category,
              label: categoryLabel(category),
            }))}
          />
          <FilterSelect
            id="teams-sport"
            label="Sport / Game"
            allLabel="All"
            value={filters.sport}
            onChange={(sport) => update({ sport: sport as TeamFilterState["sport"] })}
            options={sportOptions.map((sport) => ({ value: sport, label: sportLabel(sport) }))}
          />
          <FilterSelect
            id="teams-league"
            label="League"
            allLabel="All leagues"
            value={filters.leagueId}
            onChange={(leagueId) => update({ leagueId })}
            options={leagueOptions.map((league) => ({
              value: league.id,
              label: league.name,
            }))}
          />
        </div>

        <Button
          variant="ghost"
          className="w-fit enabled:cursor-pointer"
          disabled={activeCount === 0}
          onClick={() => setFilters(defaultTeamFilters)}
        >
          <XIcon data-icon="inline-start" />
          Reset{activeCount > 0 ? ` (${activeCount})` : ""}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {visible.length} {visible.length === 1 ? "team" : "teams"}
        {followedVisible > 0 ? ` · following ${followedVisible}` : ""}
      </p>

      {visible.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((team) => (
            <li key={team.id} className="min-w-0">
              <TeamCard team={team} className="h-full" />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={SearchXIcon}
          title="No teams found"
          description={
            filters.query.trim()
              ? `Nothing matches "${filters.query.trim()}" with the current filters.`
              : "Nothing matches the current filters."
          }
          action={
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer"
              onClick={() => setFilters(defaultTeamFilters)}
            >
              Reset filters
            </Button>
          }
          className="py-12"
        />
      )}
    </div>
  )
}
