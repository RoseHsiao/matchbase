"use client"

import { XIcon } from "lucide-react"

import { FilterField, FilterSelect } from "@/components/filters/filter-select"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { League, MatchStatus, Team } from "@/lib/data/types"
import {
  ALL,
  countActiveFilters,
  defaultScheduleFilters,
  leaguesForSport,
  reconcileFilters,
  teamsForFilters,
  type ScheduleFilterState,
} from "@/lib/schedule"
import { sportLabel, sports } from "@/lib/sports"

type ScheduleFiltersProps = {
  value: ScheduleFilterState
  onChange: (next: ScheduleFilterState) => void
  leagues: League[]
  teams: Team[]
}

const STATUS_OPTIONS: { value: MatchStatus | typeof ALL; label: string }[] = [
  { value: ALL, label: "All" },
  { value: "upcoming", label: "Upcoming" },
  { value: "live", label: "Live" },
  { value: "finished", label: "Finished" },
]

export function ScheduleFilters({
  value,
  onChange,
  leagues,
  teams,
}: ScheduleFiltersProps) {
  const activeCount = countActiveFilters(value)
  const leagueOptions = leaguesForSport(leagues, value.sport)
  const teamOptions = teamsForFilters(teams, leagues, value)

  function update(patch: Partial<ScheduleFilterState>) {
    onChange(reconcileFilters({ ...value, ...patch }, leagues, teams))
  }

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-end">
        <FilterSelect
          id="schedule-sport"
          label="Sport"
          allLabel="All sports"
          value={value.sport}
          onChange={(sport) => update({ sport: sport as ScheduleFilterState["sport"] })}
          options={sports.map((sport) => ({ value: sport, label: sportLabel(sport) }))}
        />
        <FilterSelect
          id="schedule-league"
          label="League"
          allLabel="All leagues"
          value={value.leagueId}
          onChange={(leagueId) => update({ leagueId })}
          options={leagueOptions.map((league) => ({
            value: league.id,
            label: league.name,
          }))}
        />
        <FilterSelect
          id="schedule-team"
          label="Team"
          allLabel="All teams"
          value={value.teamId}
          onChange={(teamId) => update({ teamId })}
          options={teamOptions.map((team) => ({ value: team.id, label: team.name }))}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <FilterField id="schedule-status" label="Status">
          <ToggleGroup
            aria-labelledby="schedule-status-label"
            variant="outline"
            spacing={0}
            value={[value.status]}
            onValueChange={(next) => {
              const status = next[0]
              if (typeof status === "string") {
                update({ status: status as ScheduleFilterState["status"] })
              }
            }}
          >
            {STATUS_OPTIONS.map((option) => (
              <ToggleGroupItem
                key={option.value}
                value={option.value}
                className="cursor-pointer aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/90"
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FilterField>

        <Button
          variant="ghost"
          className="enabled:cursor-pointer"
          disabled={activeCount === 0}
          onClick={() => onChange(defaultScheduleFilters)}
        >
          <XIcon data-icon="inline-start" />
          Reset{activeCount > 0 ? ` (${activeCount})` : ""}
        </Button>
      </div>
    </div>
  )
}
