"use client"

import Link from "next/link"
import { CalendarXIcon, SearchXIcon, XIcon } from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { FilterField, FilterSelect } from "@/components/filters/filter-select"
import { HierarchyFilterSelects, useHierarchyFilters } from "@/components/filters/hierarchy-filters"
import { MatchList } from "@/components/matches/match-list"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { WatchlistToggle } from "@/components/watchlist/watchlist-toggle"
import type { League, MatchStatus, MatchView, Team } from "@/lib/data/types"
import { ALL, filterMatches, matchesSearch, sortMatchesForOverview } from "@/lib/schedule"

const statusOptions: { value: MatchStatus; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "live", label: "Live" },
  { value: "finished", label: "Finished" },
]

type MatchesViewProps = {
  /** Every known match; this page filters and orders it client-side. */
  matches: MatchView[]
  leagues: League[]
  teams: Team[]
  /** Server reference time as ISO, for "Today" labels. */
  now: string
}

/**
 * Match overview: every match across sports and esports, searchable and
 * filterable, ordered live → upcoming → finished. Schedule answers "when?";
 * this page answers "what is there?".
 */
export function MatchesView({ matches, leagues, teams, now: nowIso }: MatchesViewProps) {
  const now = new Date(nowIso)
  const hierarchy = useHierarchyFilters(
    {
      query: "",
      category: ALL,
      sport: ALL,
      leagueId: ALL,
      teamId: ALL,
      status: ALL as MatchStatus | typeof ALL,
    },
    leagues,
    teams
  )
  const { filters, update, activeCount, reset } = hierarchy

  const visible = sortMatchesForOverview(
    filterMatches(matches, filters).filter((match) => matchesSearch(match, filters.query))
  )
  const live = visible.filter((match) => match.status === "live").length

  if (matches.length === 0) {
    return (
      <EmptyState
        icon={CalendarXIcon}
        title="No matches available"
        description="Matches across sports and esports will appear here once they are scheduled."
        action={
          <Link href="/schedule" className={buttonVariants({ variant: "default" })}>
            Open the schedule
          </Link>
        }
        className="py-16"
      />
    )
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <FilterField id="matches-search" label="Search">
          <Input
            id="matches-search"
            type="search"
            aria-labelledby="matches-search-label"
            placeholder="Team, league, or sport"
            value={filters.query}
            onChange={(event) => update({ query: event.target.value })}
            className="lg:w-56"
          />
        </FilterField>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-end">
          <HierarchyFilterSelects
            idPrefix="matches"
            filters={filters}
            update={update}
            sportOptions={hierarchy.sportOptions}
            leagueOptions={hierarchy.leagueOptions}
            teamOptions={hierarchy.teamOptions}
          />
          <FilterSelect
            id="matches-status"
            label="Status"
            allLabel="All"
            value={filters.status}
            onChange={(status) => update({ status: status as MatchStatus | typeof ALL })}
            options={statusOptions}
          />
        </div>
        <Button
          variant="ghost"
          className="w-fit enabled:cursor-pointer"
          disabled={activeCount === 0}
          onClick={reset}
        >
          <XIcon data-icon="inline-start" />
          Reset filters{activeCount > 0 ? ` (${activeCount})` : ""}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {visible.length} {visible.length === 1 ? "match" : "matches"}
        {live > 0 ? ` · ${live} live` : ""}
        {activeCount > 0
          ? ` · ${activeCount} ${activeCount === 1 ? "filter" : "filters"} active`
          : ""}
      </p>

      {visible.length > 0 ? (
        <Card className="py-1">
          <CardContent className="px-1">
            <MatchList
              matches={visible}
              now={now}
              groupByStatus={filters.status === ALL}
              showCategory
              renderAction={(match) => <WatchlistToggle matchId={match.id} />}
            />
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          icon={SearchXIcon}
          title="No matches found"
          description="Nothing matches the current search and filters."
          action={
            <Button variant="outline" size="sm" className="cursor-pointer" onClick={reset}>
              Reset filters
            </Button>
          }
          className="py-12"
        />
      )}
    </div>
  )
}
