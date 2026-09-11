"use client"

import * as React from "react"
import { CalendarXIcon, SearchXIcon } from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { MatchDayList } from "@/components/matches/match-day-list"
import { DateStrip, type DateStripDay } from "@/components/schedule/date-strip"
import { ScheduleFilters } from "@/components/schedule/schedule-filters"
import { Button } from "@/components/ui/button"
import type { League, MatchView, Team } from "@/lib/data/types"
import { addDays, dayKey, formatDayLabel, startOfDay } from "@/lib/format"
import {
  ALL,
  countActiveFilters,
  defaultScheduleFilters,
  filterMatches,
  groupMatchesByDay,
  type ScheduleFilterState,
} from "@/lib/schedule"

type ScheduleViewProps = {
  /** Matches inside the schedule window, in start order. */
  matches: MatchView[]
  leagues: League[]
  teams: Team[]
  /** Server reference time as ISO, so labels agree between server and client. */
  now: string
  /** Number of days in the window, starting today. */
  days: number
}

/** Client-side date and filter state over a preloaded match window. */
export function ScheduleView({
  matches,
  leagues,
  teams,
  now: nowIso,
  days,
}: ScheduleViewProps) {
  const now = new Date(nowIso)
  const [selectedDay, setSelectedDay] = React.useState(() => dayKey(now))
  const [filters, setFilters] = React.useState<ScheduleFilterState>(
    defaultScheduleFilters
  )

  const filtered = filterMatches(matches, filters)
  const dayList: DateStripDay[] = Array.from({ length: days }, (_, index) => {
    const date = addDays(startOfDay(now), index)
    const key = dayKey(date)
    return {
      key,
      date,
      count: filtered.filter((match) => dayKey(match.startsAt) === key).length,
    }
  })

  const visible =
    selectedDay === ALL
      ? filtered
      : filtered.filter((match) => dayKey(match.startsAt) === selectedDay)
  const groups = groupMatchesByDay(visible)
  const activeFilters = countActiveFilters(filters)
  // "Today" / "Tomorrow" read naturally in lowercase; calendar dates do not.
  const dayLabel = selectedDay === ALL ? null : formatDayLabel(selectedDay, now)
  const isRelativeDay = dayLabel === "Today" || dayLabel === "Tomorrow"
  const summaryLabel = dayLabel ?? `Next ${days} days`
  const dayPhrase =
    dayLabel === null
      ? `in the next ${days} days`
      : isRelativeDay
        ? dayLabel.toLowerCase()
        : `on ${dayLabel}`

  return (
    <div className="grid gap-4">
      <DateStrip
        days={dayList}
        selected={selectedDay}
        onSelect={setSelectedDay}
        now={now}
        allValue={ALL}
        allCount={filtered.length}
      />

      <ScheduleFilters
        value={filters}
        onChange={setFilters}
        leagues={leagues}
        teams={teams}
      />

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {visible.length} {visible.length === 1 ? "match" : "matches"} ·{" "}
        {summaryLabel}
        {activeFilters > 0
          ? ` · ${activeFilters} ${activeFilters === 1 ? "filter" : "filters"} active`
          : ""}
      </p>

      {groups.length > 0 ? (
        <MatchDayList groups={groups} now={now} />
      ) : activeFilters > 0 ? (
        <EmptyState
          icon={SearchXIcon}
          title="No matches match your filters"
          description={`Nothing scheduled ${dayPhrase} with the current filters.`}
          action={
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer"
              onClick={() => setFilters(defaultScheduleFilters)}
            >
              Reset filters
            </Button>
          }
          className="py-12"
        />
      ) : (
        <EmptyState
          icon={CalendarXIcon}
          title={`No matches ${dayPhrase}`}
          description="Try another day or browse the whole week."
          action={
            selectedDay !== ALL ? (
              <Button
                variant="outline"
                size="sm"
                className="cursor-pointer"
                onClick={() => setSelectedDay(ALL)}
              >
                Show all days
              </Button>
            ) : undefined
          }
          className="py-12"
        />
      )}
    </div>
  )
}
