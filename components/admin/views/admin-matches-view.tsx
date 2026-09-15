"use client"

import * as React from "react"
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"

import { useAdminCollection, useAdminLookups, useAdminNow } from "@/components/admin/admin-data-provider"
import { AdminDataTable, type AdminColumn } from "@/components/admin/admin-data-table"
import { AdminDeleteDialog } from "@/components/admin/admin-delete-dialog"
import { AdminFormDialog } from "@/components/admin/admin-form-dialog"
import { AdminPage } from "@/components/admin/admin-page"
import { AdminToolbar } from "@/components/admin/admin-toolbar"
import { DateTimeField, NumberField, SelectField, TextField } from "@/components/admin/form-fields"
import { HierarchyFilterSelects, useHierarchyFilters } from "@/components/filters/hierarchy-filters"
import { useEntityEditor } from "@/components/admin/use-entity-editor"
import { CategoryBadge } from "@/components/category-badge"
import { FilterSelect } from "@/components/filters/filter-select"
import { MatchStatusBadge } from "@/components/matches/match-status-badge"
import { TeamLogo } from "@/components/matches/team-logo"
import { Button } from "@/components/ui/button"
import { statusMeta } from "@/lib/admin/status"
import { newId } from "@/lib/collection-store"
import type { Match, MatchStatus, Season } from "@/lib/data/types"
import { formatDateTime, isSameDay, toDateTimeLocal } from "@/lib/format"
import { ALL } from "@/lib/schedule"
import { hasHomeAdvantage, sportCategory, sportLabel } from "@/lib/sports"

const matchStatusOptions: { value: MatchStatus; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "live", label: "Live" },
  { value: "finished", label: "Finished" },
]

const dateOptions = [
  { value: "today", label: "Today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
]

/** Select value for "no venue"; the stored field is null. */
const NO_VENUE = "none"

type Draft = {
  leagueId: string
  seasonId: string
  homeTeamId: string
  awayTeamId: string
  startsAt: string
  status: MatchStatus
  stage: string
  venueId: string
  homeScore: number | ""
  awayScore: number | ""
  liveDetail: string
}

const emptyDraft: Draft = { leagueId: "", seasonId: "", homeTeamId: "", awayTeamId: "", startsAt: "", status: "upcoming", stage: "", venueId: NO_VENUE, homeScore: "", awayScore: "", liveDetail: "" }

const SEASON_ORDER: Record<Season["status"], number> = { current: 0, upcoming: 1, completed: 2 }

export function AdminMatchesView() {
  const now = useAdminNow()
  const { items: matches, upsert, remove } = useAdminCollection("matches")
  const { items: leagues } = useAdminCollection("leagues")
  const { items: seasons } = useAdminCollection("seasons")
  const { items: teams } = useAdminCollection("teams")
  const { items: venues } = useAdminCollection("venues")
  const { leagueById, teamById, venueById } = useAdminLookups()
  const hierarchy = useHierarchyFilters({ category: ALL, sport: ALL, leagueId: ALL, status: ALL, date: ALL }, leagues)
  const { filters, update } = hierarchy
  const editor = useEntityEditor<Draft>(emptyDraft)
  const [deleting, setDeleting] = React.useState<Match | null>(null)

  const rows = matches.filter((match) => {
    const league = leagueById.get(match.leagueId)
    if (!league) return false
    const start = new Date(match.startsAt)
    return (
      (filters.category === ALL || sportCategory(league.sport) === filters.category) &&
      (filters.sport === ALL || league.sport === filters.sport) &&
      (filters.leagueId === ALL || match.leagueId === filters.leagueId) &&
      (filters.status === ALL || match.status === filters.status) &&
      (filters.date === ALL ||
        (filters.date === "today" && isSameDay(start, now)) ||
        (filters.date === "upcoming" && start > now) ||
        (filters.date === "past" && start <= now))
    )
  })

  const leagueOf = (match: Match) => leagueById.get(match.leagueId)
  const columns: AdminColumn<Match>[] = [
    { key: "start", header: "Date / Time", cell: (row) => <time dateTime={row.startsAt} className="tabular-nums">{formatDateTime(row.startsAt)}</time>, sortValue: (row) => row.startsAt, className: "whitespace-nowrap" },
    { key: "category", header: "Category", cell: (row) => { const l = leagueOf(row); return l ? <CategoryBadge category={sportCategory(l.sport)} /> : "—" } },
    { key: "sport", header: "Sport / Game", cell: (row) => { const l = leagueOf(row); return l ? sportLabel(l.sport) : "—" }, sortValue: (row) => { const l = leagueOf(row); return l ? sportLabel(l.sport) : "" } },
    { key: "league", header: "League", cell: (row) => leagueOf(row)?.shortName ?? "—", sortValue: (row) => leagueOf(row)?.name ?? "" },
    {
      key: "participants",
      header: "Participants",
      cell: (row) => {
        const home = teamById.get(row.homeTeamId)
        const away = teamById.get(row.awayTeamId)
        const league = leagueOf(row)
        const sides = league ? hasHomeAdvantage(league.sport) : false
        return (
          <span className="grid gap-0.5 leading-tight">
            <span className="flex items-center gap-1.5">
              {home ? <TeamLogo team={home} size="xs" /> : null}
              <span className="font-medium">{home?.name ?? row.homeTeamId}</span>
              <span className="text-muted-foreground">vs</span>
              {away ? <TeamLogo team={away} size="xs" /> : null}
              <span className="font-medium">{away?.name ?? row.awayTeamId}</span>
            </span>
            <span className="text-xs text-muted-foreground">
              {sides ? "Home · Away" : row.stage ?? "Series"}
            </span>
          </span>
        )
      },
    },
    { key: "status", header: "Status", cell: (row) => <MatchStatusBadge status={row.status} liveDetail={row.liveDetail} />, sortValue: (row) => row.status },
    { key: "score", header: "Score", cell: (row) => (row.score ? `${row.score.home}–${row.score.away}` : "—"), className: "tabular-nums whitespace-nowrap" },
  ]

  const draftLeague = editor.draft.leagueId ? leagueById.get(editor.draft.leagueId) : undefined
  const draftTeams = teams.filter((t) => t.leagueId === editor.draft.leagueId)
  const draftSeasons = seasons
    .filter((s) => s.leagueId === editor.draft.leagueId)
    .sort((a, b) => SEASON_ORDER[a.status] - SEASON_ORDER[b.status] || b.startsAt.localeCompare(a.startsAt))
  const draftSides = draftLeague ? hasHomeAdvantage(draftLeague.sport) : true
  const showScore = editor.draft.status !== "upcoming"

  /** Default a new match to the league's current season (first in the ordered list). */
  function selectLeague(leagueId: string) {
    const first = seasons
      .filter((s) => s.leagueId === leagueId)
      .sort((a, b) => SEASON_ORDER[a.status] - SEASON_ORDER[b.status] || b.startsAt.localeCompare(a.startsAt))[0]
    editor.patch({ leagueId, seasonId: first?.id ?? "", homeTeamId: "", awayTeamId: "" })
  }

  function submit() {
    const { leagueId, seasonId, homeTeamId, awayTeamId, startsAt } = editor.draft
    if (!leagueId || !seasonId || !homeTeamId || !awayTeamId || !startsAt || homeTeamId === awayTeamId) return
    const homeScore = editor.draft.homeScore
    const awayScore = editor.draft.awayScore
    const venueId = editor.draft.venueId === NO_VENUE ? undefined : editor.draft.venueId
    upsert({
      id: editor.editingId ?? newId("match"),
      leagueId,
      seasonId,
      homeTeamId,
      awayTeamId,
      startsAt: new Date(startsAt).toISOString(),
      status: editor.draft.status,
      stage: editor.draft.stage.trim() || undefined,
      venueId,
      venue: venueId ? venueById.get(venueId)?.name : undefined,
      score: showScore && homeScore !== "" && awayScore !== "" ? { home: homeScore, away: awayScore } : undefined,
      liveDetail: editor.draft.status === "live" && editor.draft.liveDetail.trim() ? editor.draft.liveDetail.trim() : undefined,
    })
    editor.close()
  }

  const matchName = (match: Match) =>
    `${teamById.get(match.homeTeamId)?.name ?? match.homeTeamId} vs ${teamById.get(match.awayTeamId)?.name ?? match.awayTeamId}`

  return (
    <AdminPage
      title="Matches"
      description="Fixtures, live matches, and results across sports and esports. The same records power Schedule, Match Detail, and the Dashboard."
      actions={<Button className="cursor-pointer" onClick={editor.openCreate}><PlusIcon data-icon="inline-start" />Add match</Button>}
    >
      <AdminToolbar activeCount={hierarchy.activeCount} onReset={hierarchy.reset}>
        <HierarchyFilterSelects idPrefix="admin-matches" filters={filters} update={update} sportOptions={hierarchy.sportOptions} leagueOptions={hierarchy.leagueOptions} />
        <FilterSelect id="admin-matches-status" label="Status" allLabel="All" value={filters.status} onChange={(status) => update({ status })} options={matchStatusOptions} />
        <FilterSelect id="admin-matches-date" label="Date" allLabel="All dates" value={filters.date} onChange={(date) => update({ date })} options={dateOptions} />
      </AdminToolbar>

      <AdminDataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        noun="match"
        nounPlural="matches"
        pageSize={12}
        defaultSort={{ key: "start", direction: "asc" }}
        rowActions={[
          { label: "Edit", icon: PencilIcon, onSelect: (row) => editor.openEdit(row.id, { leagueId: row.leagueId, seasonId: row.seasonId ?? "", homeTeamId: row.homeTeamId, awayTeamId: row.awayTeamId, startsAt: toDateTimeLocal(row.startsAt), status: row.status, stage: row.stage ?? "", venueId: row.venueId ?? NO_VENUE, homeScore: row.score?.home ?? "", awayScore: row.score?.away ?? "", liveDetail: row.liveDetail ?? "" }) },
          { label: "Delete", icon: Trash2Icon, destructive: true, onSelect: setDeleting },
        ]}
        emptyTitle="No matches match"
        emptyDescription="Adjust the filters or add a match."
        emptyAction={<Button variant="outline" size="sm" className="cursor-pointer" onClick={hierarchy.reset}>Reset filters</Button>}
      />

      <AdminFormDialog
        open={editor.open}
        onOpenChange={editor.setOpen}
        title={editor.editingId ? "Edit match" : "Add match"}
        description={draftLeague ? `${sportLabel(draftLeague.sport)} · ${draftLeague.name}` : "Pick a league first; seasons and teams are limited to that league."}
        submitLabel={editor.editingId ? "Save changes" : "Add match"}
        onSubmit={submit}
      >
        <SelectField id="match-league" label="League" value={editor.draft.leagueId} onChange={selectLeague} options={leagues.map((l) => ({ value: l.id, label: `${l.name} · ${sportLabel(l.sport)}` }))} />
        <SelectField id="match-season" label="Season" value={editor.draft.seasonId} onChange={(seasonId) => editor.patch({ seasonId })} options={draftSeasons.map((s) => ({ value: s.id, label: `${s.name} · ${statusMeta[s.status].label}` }))} placeholder={draftLeague ? (draftSeasons.length ? "Select season" : "No seasons for this league") : "Pick a league first"} />
        <SelectField id="match-home" label={draftSides ? "Home team" : "Team A"} value={editor.draft.homeTeamId} onChange={(homeTeamId) => editor.patch({ homeTeamId })} options={draftTeams.map((t) => ({ value: t.id, label: t.name }))} placeholder={draftLeague ? "Select team" : "Pick a league first"} />
        <SelectField id="match-away" label={draftSides ? "Away team" : "Team B"} value={editor.draft.awayTeamId} onChange={(awayTeamId) => editor.patch({ awayTeamId })} options={draftTeams.filter((t) => t.id !== editor.draft.homeTeamId).map((t) => ({ value: t.id, label: t.name }))} placeholder={draftLeague ? "Select team" : "Pick a league first"} />
        <DateTimeField id="match-start" label="Start" value={editor.draft.startsAt} onChange={(startsAt) => editor.patch({ startsAt })} />
        <SelectField id="match-status" label="Status" value={editor.draft.status} onChange={(status) => editor.patch({ status: status as MatchStatus })} options={matchStatusOptions} />
        <TextField id="match-stage" label="Stage" value={editor.draft.stage} onChange={(stage) => editor.patch({ stage })} placeholder="e.g. Matchweek 5 or Playoffs · Final" />
        <SelectField id="match-venue" label="Venue" value={editor.draft.venueId} onChange={(venueId) => editor.patch({ venueId })} options={[{ value: NO_VENUE, label: "No venue" }, ...venues.map((v) => ({ value: v.id, label: v.name }))]} hint={draftSides ? "Physical venue." : "Optional. Esports matches may be studio or online."} />
        {showScore ? (
          <>
            <NumberField id="match-home-score" label={draftSides ? "Home score" : "Team A score"} value={editor.draft.homeScore} onChange={(homeScore) => editor.patch({ homeScore })} min={0} />
            <NumberField id="match-away-score" label={draftSides ? "Away score" : "Team B score"} value={editor.draft.awayScore} onChange={(awayScore) => editor.patch({ awayScore })} min={0} />
          </>
        ) : null}
        {editor.draft.status === "live" ? (
          <TextField id="match-live" label="Live detail" value={editor.draft.liveDetail} onChange={(liveDetail) => editor.patch({ liveDetail })} placeholder="e.g. 67' or Map 3" full />
        ) : null}
      </AdminFormDialog>

      <AdminDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null) }}
        name={deleting ? matchName(deleting) : "match"}
        description="Watchlist entries for this match are removed with it."
        onConfirm={() => { if (deleting) remove(deleting.id) }}
      />
    </AdminPage>
  )
}
