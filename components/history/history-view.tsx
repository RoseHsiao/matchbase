"use client"

import Link from "next/link"
import { CalendarXIcon, SearchXIcon, StarIcon } from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { FilterField, FilterSelect } from "@/components/filters/filter-select"
import { HierarchyFilterSelects, useHierarchyFilters } from "@/components/filters/hierarchy-filters"
import { MatchDayList } from "@/components/matches/match-day-list"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useWatchlist } from "@/components/watchlist/watchlist-provider"
import type { League, MatchView, Team } from "@/lib/data/types"
import { dayDifference } from "@/lib/format"
import { participantSearchTerms } from "@/lib/matches"
import { ALL, filterMatches, groupMatchesByDay } from "@/lib/schedule"

const dateOptions = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "Last 7 days" },
  { value: "older", label: "Older" },
]

type HistoryViewProps = {
  /** Finished matches, most recent first. */
  matches: MatchView[]
  leagues: League[]
  teams: Team[]
  /** Server reference time as ISO, for "Yesterday" labels. */
  now: string
}

/**
 * Personal record of completed matches. Derived from the shared match data:
 * anything finished is history, and matches the user had on the watchlist are
 * marked as watched.
 */
export function HistoryView({ matches, leagues, teams, now: nowIso }: HistoryViewProps) {
  const now = new Date(nowIso)
  const hierarchy = useHierarchyFilters(
    { query: "", category: ALL, sport: ALL, leagueId: ALL, teamId: ALL, date: ALL },
    leagues,
    teams
  )
  const { filters, update } = hierarchy
  const { ids: watchlistIds } = useWatchlist()

  const query = filters.query.trim().toLowerCase()
  const visible = filterMatches(matches, { ...filters, status: ALL }).filter((match) => {
    const daysAgo = dayDifference(match.startsAt, now)
    const inDate =
      filters.date === ALL ||
      (filters.date === "today" && daysAgo === 0) ||
      (filters.date === "yesterday" && daysAgo === 1) ||
      (filters.date === "week" && daysAgo >= 0 && daysAgo <= 7) ||
      (filters.date === "older" && daysAgo > 7)
    const inQuery =
      !query || participantSearchTerms(match).some((v) => v.toLowerCase().includes(query))
    return inDate && inQuery
  })
  const groups = groupMatchesByDay(visible, "desc")
  const watched = visible.filter((match) => watchlistIds.has(match.id)).length

  if (matches.length === 0) {
    return (
      <EmptyState
        icon={CalendarXIcon}
        title="No completed matches yet"
        description="Finished matches from every sport and game you follow will appear here."
        action={
          <Link href="/schedule" className={buttonVariants({ variant: "default" })}>
            Browse the schedule
          </Link>
        }
        className="py-16"
      />
    )
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <FilterField id="history-search" label="Search">
          <Input
            id="history-search"
            type="search"
            aria-labelledby="history-search-label"
            placeholder="Team name or code"
            value={filters.query}
            onChange={(event) => update({ query: event.target.value })}
            className="lg:w-56"
          />
        </FilterField>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-end">
          <HierarchyFilterSelects
            idPrefix="history"
            filters={filters}
            update={update}
            sportOptions={hierarchy.sportOptions}
            leagueOptions={hierarchy.leagueOptions}
            teamOptions={hierarchy.teamOptions}
          />
          <FilterSelect
            id="history-date"
            label="Date"
            allLabel="All dates"
            value={filters.date}
            onChange={(date) => update({ date })}
            options={dateOptions}
          />
        </div>
        <Button
          variant="ghost"
          className="w-fit enabled:cursor-pointer"
          disabled={hierarchy.activeCount === 0}
          onClick={hierarchy.reset}
        >
          Reset{hierarchy.activeCount > 0 ? ` (${hierarchy.activeCount})` : ""}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {visible.length} completed {visible.length === 1 ? "match" : "matches"}
        {watched > 0 ? ` · ${watched} watched` : ""}
        {hierarchy.activeCount > 0
          ? ` · ${hierarchy.activeCount} ${hierarchy.activeCount === 1 ? "filter" : "filters"} active`
          : ""}
      </p>

      {groups.length > 0 ? (
        <MatchDayList
          groups={groups}
          now={now}
          renderAction={(match) =>
            watchlistIds.has(match.id) ? (
              <Badge variant="secondary" className="mr-1">
                <StarIcon data-icon="inline-start" className="fill-current" />
                Watched
              </Badge>
            ) : null
          }
        />
      ) : (
        <EmptyState
          icon={SearchXIcon}
          title="No completed matches match your filters"
          description="Try a wider date range or clear the filters."
          action={
            <Button variant="outline" size="sm" className="cursor-pointer" onClick={hierarchy.reset}>
              Reset filters
            </Button>
          }
          className="py-12"
        />
      )}
    </div>
  )
}
