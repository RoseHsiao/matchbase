"use client"

import { XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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

type FilterFieldProps = {
  id: string
  label: string
  children: React.ReactNode
}

/**
 * Label above a control. Every filter uses it so labels, gaps, and control
 * heights line up across the row. The label id is `${id}-label`.
 */
function FilterField({ id, label, children }: FilterFieldProps) {
  return (
    <div className="grid min-w-0 gap-1">
      <span id={`${id}-label`} className="text-xs font-medium text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  )
}

type FilterSelectProps = {
  id: string
  label: string
  allLabel: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}

function FilterSelect({
  id,
  label,
  allLabel,
  value,
  onChange,
  options,
}: FilterSelectProps) {
  const items = {
    [ALL]: allLabel,
    ...Object.fromEntries(options.map((option) => [option.value, option.label])),
  }

  return (
    <FilterField id={id} label={label}>
      <Select
        value={value}
        items={items}
        onValueChange={(next) => {
          if (typeof next === "string") onChange(next)
        }}
      >
        <SelectTrigger
          aria-labelledby={`${id}-label`}
          className="w-full cursor-pointer lg:w-44"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false}>
          <SelectItem value={ALL} className="cursor-pointer">
            {allLabel}
          </SelectItem>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="cursor-pointer"
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FilterField>
  )
}
