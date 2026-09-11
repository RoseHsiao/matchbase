"use client"

import * as React from "react"
import { SearchIcon, SearchXIcon, XIcon } from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { FilterField, FilterSelect } from "@/components/filters/filter-select"
import { PlayerCard } from "@/components/players/player-card"
import { usePlayerFollows } from "@/components/players/player-follows-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { League, PlayerView, Team } from "@/lib/data/types"
import {
  countActivePlayerFilters,
  defaultPlayerFilters,
  filterPlayers,
  reconcilePlayerFilters,
  type PlayerFilterState,
} from "@/lib/players"
import { leaguesForFilters, sportsForCategory, teamsForFilters } from "@/lib/schedule"
import { categories, categoryLabel, sportLabel } from "@/lib/sports"

type PlayersViewProps = {
  players: PlayerView[]
  leagues: League[]
  teams: Team[]
}

/** Client-side search and filters over a preloaded player list. */
export function PlayersView({ players, leagues, teams }: PlayersViewProps) {
  const [filters, setFilters] = React.useState<PlayerFilterState>(defaultPlayerFilters)
  const { ids: followedIds } = usePlayerFollows()

  const visible = filterPlayers(players, filters)
  const followedVisible = visible.filter((player) => followedIds.has(player.id)).length
  const activeCount = countActivePlayerFilters(filters)
  const sportOptions = sportsForCategory(filters.category)
  const leagueOptions = leaguesForFilters(leagues, filters)
  const teamOptions = teamsForFilters(teams, leagues, filters)

  function update(patch: Partial<PlayerFilterState>) {
    setFilters((current) =>
      reconcilePlayerFilters({ ...current, ...patch }, leagues, teams)
    )
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <FilterField id="players-search" label="Search">
          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              aria-labelledby="players-search-label"
              placeholder="Player name or handle"
              value={filters.query}
              onChange={(event) => update({ query: event.target.value })}
              className="pl-8 lg:w-64"
            />
          </div>
        </FilterField>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:flex lg:items-end">
          <FilterSelect
            id="players-category"
            label="Category"
            allLabel="All"
            value={filters.category}
            onChange={(category) =>
              update({ category: category as PlayerFilterState["category"] })
            }
            options={categories.map((category) => ({
              value: category,
              label: categoryLabel(category),
            }))}
          />
          <FilterSelect
            id="players-sport"
            label="Sport / Game"
            allLabel="All"
            value={filters.sport}
            onChange={(sport) => update({ sport: sport as PlayerFilterState["sport"] })}
            options={sportOptions.map((sport) => ({ value: sport, label: sportLabel(sport) }))}
          />
          <FilterSelect
            id="players-league"
            label="League"
            allLabel="All leagues"
            value={filters.leagueId}
            onChange={(leagueId) => update({ leagueId })}
            options={leagueOptions.map((league) => ({
              value: league.id,
              label: league.name,
            }))}
          />
          <FilterSelect
            id="players-team"
            label="Team"
            allLabel="All teams"
            value={filters.teamId}
            onChange={(teamId) => update({ teamId })}
            options={teamOptions.map((team) => ({ value: team.id, label: team.name }))}
          />
        </div>

        <Button
          variant="ghost"
          className="w-fit enabled:cursor-pointer"
          disabled={activeCount === 0}
          onClick={() => setFilters(defaultPlayerFilters)}
        >
          <XIcon data-icon="inline-start" />
          Reset{activeCount > 0 ? ` (${activeCount})` : ""}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {visible.length} {visible.length === 1 ? "player" : "players"}
        {followedVisible > 0 ? ` · following ${followedVisible}` : ""}
      </p>

      {visible.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((player) => (
            <li key={player.id} className="min-w-0">
              <PlayerCard player={player} className="h-full" />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={SearchXIcon}
          title="No players found"
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
              onClick={() => setFilters(defaultPlayerFilters)}
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
