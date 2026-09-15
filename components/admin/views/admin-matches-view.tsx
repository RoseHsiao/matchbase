"use client"

import * as React from "react"
import { PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react"

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
import { ParticipantAvatars } from "@/components/matches/side-participants"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { statusMeta } from "@/lib/admin/status"
import { newId } from "@/lib/collection-store"
import { participantsFromSides, validateParticipants, type ParticipantRef } from "@/lib/data/match-participants"
import type { Match, MatchParticipantView, MatchSide, MatchStatus, Player, Season, Team } from "@/lib/data/types"
import { formatDateTime, isSameDay, toDateTimeLocal } from "@/lib/format"
import { SIDES, sideName, sideParticipants, sideRole } from "@/lib/matches"
import { playerDisplayName } from "@/lib/players"
import { ALL } from "@/lib/schedule"
import { sportCategory, sportLabel } from "@/lib/sports"

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

/** A participant slot in the form: "team:<id>", "player:<id>", or "" while unselected. */
type ParticipantKey = string

type Draft = {
  leagueId: string
  seasonId: string
  sides: Record<MatchSide, ParticipantKey[]>
  startsAt: string
  status: MatchStatus
  stage: string
  venueId: string
  sideAScore: number | ""
  sideBScore: number | ""
  liveDetail: string
}

const emptyDraft: Draft = { leagueId: "", seasonId: "", sides: { A: [""], B: [""] }, startsAt: "", status: "upcoming", stage: "", venueId: NO_VENUE, sideAScore: "", sideBScore: "", liveDetail: "" }

const SEASON_ORDER: Record<Season["status"], number> = { current: 0, upcoming: 1, completed: 2 }

function keyOf(participant: { teamId?: string; playerId?: string }): ParticipantKey {
  return participant.teamId ? `team:${participant.teamId}` : participant.playerId ? `player:${participant.playerId}` : ""
}

function refOf(key: ParticipantKey): ParticipantRef | undefined {
  const [kind, id] = key.split(":", 2)
  if (!id) return undefined
  return kind === "team" ? { teamId: id } : kind === "player" ? { playerId: id } : undefined
}

export function AdminMatchesView() {
  const now = useAdminNow()
  const { items: matches, upsert, remove } = useAdminCollection("matches")
  const { items: leagues } = useAdminCollection("leagues")
  const { items: seasons } = useAdminCollection("seasons")
  const { items: teams } = useAdminCollection("teams")
  const { items: players } = useAdminCollection("players")
  const { items: venues } = useAdminCollection("venues")
  const { leagueById, teamById, venueById } = useAdminLookups()
  const playerById = React.useMemo(() => new Map(players.map((p) => [p.id, p])), [players])
  const hierarchy = useHierarchyFilters({ category: ALL, sport: ALL, leagueId: ALL, status: ALL, date: ALL }, leagues)
  const { filters, update } = hierarchy
  const editor = useEntityEditor<Draft>(emptyDraft)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [deleting, setDeleting] = React.useState<Match | null>(null)

  /** Join a stored match with its teams and players for display, from the admin collections. */
  const withParticipants = React.useCallback(
    (match: Match): { participants: MatchParticipantView[] } => ({
      participants: match.participants.map((p) => ({ ...p, team: p.teamId ? teamById.get(p.teamId) : undefined, player: p.playerId ? playerById.get(p.playerId) : undefined })),
    }),
    [teamById, playerById]
  )

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
        const view = withParticipants(row)
        const league = leagueOf(row)
        const roles = league ? SIDES.map((side) => sideRole(league.sport, side)).filter(Boolean) : []
        return (
          <span className="grid gap-0.5 leading-tight">
            <span className="flex items-center gap-1.5">
              <ParticipantAvatars participants={sideParticipants(view, "A")} size="xs" />
              <span className="font-medium">{sideName(view, "A")}</span>
              <span className="text-muted-foreground">vs</span>
              <ParticipantAvatars participants={sideParticipants(view, "B")} size="xs" />
              <span className="font-medium">{sideName(view, "B")}</span>
            </span>
            <span className="text-xs text-muted-foreground">
              {roles.length ? roles.join(" · ") : row.stage ?? "Side A · Side B"}
            </span>
          </span>
        )
      },
    },
    { key: "status", header: "Status", cell: (row) => <MatchStatusBadge status={row.status} liveDetail={row.liveDetail} />, sortValue: (row) => row.status },
    { key: "score", header: "Score", cell: (row) => (row.score ? `${row.score.a}–${row.score.b}` : "—"), className: "tabular-nums whitespace-nowrap" },
  ]

  const draftLeague = editor.draft.leagueId ? leagueById.get(editor.draft.leagueId) : undefined
  const draftSeasons = seasons
    .filter((s) => s.leagueId === editor.draft.leagueId)
    .sort((a, b) => SEASON_ORDER[a.status] - SEASON_ORDER[b.status] || b.startsAt.localeCompare(a.startsAt))
  const showScore = editor.draft.status !== "upcoming"
  const roleA = draftLeague ? sideRole(draftLeague.sport, "A") : undefined
  const roleB = draftLeague ? sideRole(draftLeague.sport, "B") : undefined
  const sideLabel = (side: MatchSide) => (side === "A" ? (roleA ?? "Side A") : (roleB ?? "Side B"))

  /**
   * Participant choices for the selected league: its teams, the players on
   * those teams, and every player without a team (individual athletes).
   */
  const participantOptions = React.useMemo(() => {
    if (!editor.draft.leagueId) return []
    const leagueTeams = teams.filter((t) => t.leagueId === editor.draft.leagueId)
    const teamIds = new Set(leagueTeams.map((t) => t.id))
    const eligible = players.filter((p) => p.teamId === undefined || teamIds.has(p.teamId))
    return [
      ...leagueTeams.map((t: Team) => ({ value: `team:${t.id}`, label: `Team · ${t.name}` })),
      ...eligible.map((p: Player) => ({ value: `player:${p.id}`, label: `Player · ${playerDisplayName(p)}${p.teamId ? ` (${teamById.get(p.teamId)?.code ?? ""})` : ""}` })),
    ]
  }, [editor.draft.leagueId, teams, players, teamById])

  /** Default a new match to the league's current season (first in the ordered list). */
  function selectLeague(leagueId: string) {
    const first = seasons
      .filter((s) => s.leagueId === leagueId)
      .sort((a, b) => SEASON_ORDER[a.status] - SEASON_ORDER[b.status] || b.startsAt.localeCompare(a.startsAt))[0]
    editor.patch({ leagueId, seasonId: first?.id ?? "", sides: { A: [""], B: [""] } })
    setFormError(null)
  }

  function setSlot(side: MatchSide, index: number, key: ParticipantKey) {
    const next = editor.draft.sides[side].map((k, i) => (i === index ? key : k))
    editor.patch({ sides: { ...editor.draft.sides, [side]: next } })
    setFormError(null)
  }
  function addSlot(side: MatchSide) {
    editor.patch({ sides: { ...editor.draft.sides, [side]: [...editor.draft.sides[side], ""] } })
  }
  function removeSlot(side: MatchSide, index: number) {
    const next = editor.draft.sides[side].filter((_, i) => i !== index)
    editor.patch({ sides: { ...editor.draft.sides, [side]: next.length ? next : [""] } })
  }

  function submit() {
    const { leagueId, seasonId, startsAt } = editor.draft
    if (!leagueId || !seasonId) return
    const refs = (side: MatchSide) => editor.draft.sides[side].map(refOf).filter((r): r is ParticipantRef => r !== undefined)
    const validation = validateParticipants(participantsFromSides({ A: refs("A"), B: refs("B") }))
    if (!validation.ok) {
      setFormError(validation.error)
      return
    }
    if (!startsAt) {
      setFormError("Pick a start date and time.")
      return
    }
    const a = editor.draft.sideAScore
    const b = editor.draft.sideBScore
    if (showScore && (a === "") !== (b === "")) {
      setFormError("Enter both scores or neither.")
      return
    }
    const venueId = editor.draft.venueId === NO_VENUE ? undefined : editor.draft.venueId
    const id = editor.editingId ?? newId("match")
    upsert({
      id,
      leagueId,
      seasonId,
      participants: validation.participants.map((p) => ({ id: `${id}-${p.side}${p.order}`, side: p.side, order: p.order, teamId: p.teamId, playerId: p.playerId })),
      startsAt: new Date(startsAt).toISOString(),
      status: editor.draft.status,
      stage: editor.draft.stage.trim() || undefined,
      venueId,
      venue: venueId ? venueById.get(venueId)?.name : undefined,
      score: showScore && a !== "" && b !== "" ? { a, b } : undefined,
      liveDetail: editor.draft.status === "live" && editor.draft.liveDetail.trim() ? editor.draft.liveDetail.trim() : undefined,
    })
    setFormError(null)
    editor.close()
  }

  const matchName = (match: Match) => {
    const view = withParticipants(match)
    return `${sideName(view, "A")} vs ${sideName(view, "B")}`
  }

  return (
    <AdminPage
      title="Matches"
      description="Fixtures, live matches, and results across sports and esports. Each side holds a team, a player, or a doubles pair. The same records power Schedule, Match Detail, and the Dashboard."
      actions={<Button className="cursor-pointer" onClick={() => { setFormError(null); editor.openCreate() }}><PlusIcon data-icon="inline-start" />Add match</Button>}
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
          {
            label: "Edit",
            icon: PencilIcon,
            onSelect: (row) => {
              setFormError(null)
              editor.openEdit(row.id, {
                leagueId: row.leagueId,
                seasonId: row.seasonId ?? "",
                sides: {
                  A: sideParticipants(row, "A").map(keyOf).concat(sideParticipants(row, "A").length ? [] : [""]),
                  B: sideParticipants(row, "B").map(keyOf).concat(sideParticipants(row, "B").length ? [] : [""]),
                },
                startsAt: toDateTimeLocal(row.startsAt),
                status: row.status,
                stage: row.stage ?? "",
                venueId: row.venueId ?? NO_VENUE,
                sideAScore: row.score?.a ?? "",
                sideBScore: row.score?.b ?? "",
                liveDetail: row.liveDetail ?? "",
              })
            },
          },
          { label: "Delete", icon: Trash2Icon, destructive: true, onSelect: setDeleting },
        ]}
        emptyTitle="No matches match"
        emptyDescription="Adjust the filters or add a match."
        emptyAction={<Button variant="outline" size="sm" className="cursor-pointer" onClick={hierarchy.reset}>Reset filters</Button>}
      />

      <AdminFormDialog
        open={editor.open}
        onOpenChange={(open) => { if (!open) setFormError(null); editor.setOpen(open) }}
        title={editor.editingId ? "Edit match" : "Add match"}
        description={draftLeague ? `${sportLabel(draftLeague.sport)} · ${draftLeague.name}` : "Pick a league first; seasons, teams, and players are limited to that league."}
        submitLabel={editor.editingId ? "Save changes" : "Add match"}
        onSubmit={submit}
      >
        <SelectField id="match-league" label="League" value={editor.draft.leagueId} onChange={selectLeague} options={leagues.map((l) => ({ value: l.id, label: `${l.name} · ${sportLabel(l.sport)}` }))} full />
        <SelectField id="match-season" label="Season" value={editor.draft.seasonId} onChange={(seasonId) => editor.patch({ seasonId })} options={draftSeasons.map((s) => ({ value: s.id, label: `${s.name} · ${statusMeta[s.status].label}` }))} placeholder={draftLeague ? (draftSeasons.length ? "Select season" : "No seasons for this league") : "Pick a league first"} full />

        {SIDES.map((side) => (
          <div key={side} className="grid gap-1.5" data-side={side}>
            <Label>{sideLabel(side)}</Label>
            {editor.draft.sides[side].map((key, index) => {
              const taken = new Set([...editor.draft.sides.A, ...editor.draft.sides.B].filter((k) => k && k !== key))
              return (
                <div key={`${side}-${index}`} className="flex items-center gap-1.5">
                  <div className="min-w-0 flex-1">
                    <SelectField
                      id={`match-side-${side.toLowerCase()}-${index + 1}`}
                      label={`${sideLabel(side)} participant ${index + 1}`}
                      value={key}
                      onChange={(value) => setSlot(side, index, value)}
                      options={participantOptions.filter((o) => !taken.has(o.value))}
                      placeholder={draftLeague ? "Select team or player" : "Pick a league first"}
                      hideLabel
                    />
                  </div>
                  {editor.draft.sides[side].length > 1 ? (
                    <Button type="button" variant="ghost" size="icon-sm" className="cursor-pointer" aria-label={`Remove ${sideLabel(side)} participant ${index + 1}`} onClick={() => removeSlot(side, index)}>
                      <XIcon />
                    </Button>
                  ) : null}
                </div>
              )
            })}
            <Button type="button" variant="outline" size="sm" className="w-fit cursor-pointer" onClick={() => addSlot(side)} disabled={!draftLeague}>
              <PlusIcon data-icon="inline-start" />
              Add participant
            </Button>
          </div>
        ))}

        <DateTimeField id="match-start" label="Start" value={editor.draft.startsAt} onChange={(startsAt) => editor.patch({ startsAt })} />
        <SelectField id="match-status" label="Status" value={editor.draft.status} onChange={(status) => editor.patch({ status: status as MatchStatus })} options={matchStatusOptions} />
        <TextField id="match-stage" label="Stage" value={editor.draft.stage} onChange={(stage) => editor.patch({ stage })} placeholder="e.g. Matchweek 5 or Quarterfinal" />
        <SelectField id="match-venue" label="Venue" value={editor.draft.venueId} onChange={(venueId) => editor.patch({ venueId })} options={[{ value: NO_VENUE, label: "No venue" }, ...venues.map((v) => ({ value: v.id, label: v.name }))]} hint="Optional. Esports and many individual events have no physical venue." />
        {showScore ? (
          <>
            <NumberField id="match-side-a-score" label={`${sideLabel("A")} score`} value={editor.draft.sideAScore} onChange={(sideAScore) => editor.patch({ sideAScore })} min={0} />
            <NumberField id="match-side-b-score" label={`${sideLabel("B")} score`} value={editor.draft.sideBScore} onChange={(sideBScore) => editor.patch({ sideBScore })} min={0} />
          </>
        ) : null}
        {editor.draft.status === "live" ? (
          <TextField id="match-live" label="Live detail" value={editor.draft.liveDetail} onChange={(liveDetail) => editor.patch({ liveDetail })} placeholder="e.g. 67', Map 3, or Set 2" full />
        ) : null}
        {formError ? (
          <p role="alert" className="text-sm text-destructive sm:col-span-2">{formError}</p>
        ) : null}
      </AdminFormDialog>

      <AdminDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null) }}
        name={deleting ? matchName(deleting) : "match"}
        description="Participants and watchlist entries for this match are removed with it."
        onConfirm={() => { if (deleting) remove(deleting.id) }}
      />
    </AdminPage>
  )
}
