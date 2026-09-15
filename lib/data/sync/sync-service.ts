import "server-only"

import { syncRepository } from "@/lib/data/repositories/sync-repository"
import { resolveSides, toPersistable } from "@/lib/data/sync/participants"
import { resolveProvider } from "@/lib/data/sync/providers/registry"
import type {
  NormalizedMatch,
  NormalizedSnapshot,
  SyncContext,
  SyncCounts,
  SyncEntityKind,
  SyncIssue,
  SyncResult,
  SyncStatus,
} from "@/lib/data/sync/types"
import type { MatchStatus as DbMatchStatus } from "@/lib/generated/prisma/enums"

/**
 * One synchronisation run for one DataSource:
 *
 *   load DataSource → resolve provider → SyncLog RUNNING → provider.fetch →
 *   provider.normalize → upsert leagues → seasons → venues → teams →
 *   players → matches → SyncLog SUCCESS | PARTIAL | FAILED → lastSyncedAt
 *
 * The service knows nothing about sports or providers beyond the `Provider`
 * contract. Record-level problems are collected as issues and never abort
 * the run; only fetch/normalize failures or a missing provider do.
 *
 * Outcome: FAILED when nothing could be written (or the run aborted),
 * PARTIAL when some records failed, SUCCESS otherwise. Warnings (unknown
 * statuses, demoted seasons) are stored in the log's `error` column as notes
 * but do not change a SUCCESS outcome.
 */

const SYNC_LOG_ENTITY = "all"
const MAX_ERROR_LENGTH = 2000

const matchStatus: Record<Exclude<NormalizedMatch["status"], "unknown">, DbMatchStatus> = {
  upcoming: "UPCOMING",
  live: "LIVE",
  finished: "FINISHED",
}

function emptyCounts(): SyncCounts {
  const zero = () => ({ created: 0, updated: 0, failed: 0 })
  return { leagues: zero(), seasons: zero(), teams: zero(), players: zero(), venues: zero(), matches: zero() }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function issuesToText(issues: SyncIssue[]): string | null {
  if (issues.length === 0) return null
  const text = issues.map((issue) => `${issue.level.toUpperCase()} ${issue.entity}${issue.externalId ? ` ${issue.externalId}` : ""}: ${issue.message}`).join("\n")
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH - 1)}…` : text
}

export type SyncOptions = {
  /** Reference time for the run; defaults to the wall clock. */
  now?: Date
  signal?: AbortSignal
}

export async function syncDataSource(dataSourceId: string, options: SyncOptions = {}): Promise<SyncResult> {
  const startedAt = options.now ?? new Date()
  const clock = Date.now()
  const counts = emptyCounts()
  const issues: SyncIssue[] = []
  const base = (status: SyncStatus, extra: Partial<SyncResult> = {}): SyncResult => ({
    dataSourceId,
    provider: null,
    status,
    records: 0,
    durationMs: Date.now() - clock,
    counts,
    issues,
    syncLogId: null,
    ...extra,
  })

  const source = await syncRepository.findDataSource(dataSourceId)
  if (!source) return base("FAILED", { error: `Data source "${dataSourceId}" does not exist.` })

  const syncLogId = await syncRepository.startSyncLog(dataSourceId, SYNC_LOG_ENTITY, startedAt)
  const fail = async (error: string): Promise<SyncResult> => {
    await syncRepository.finishSyncLog(syncLogId, { status: "FAILED", records: 0, durationMs: Date.now() - clock, error })
    return base("FAILED", { syncLogId, error })
  }

  const provider = resolveProvider(dataSourceId)
  if (!provider) return fail("No provider is registered for this data source.")
  if (source.sportId && source.sportId !== provider.sport) {
    return fail(`Provider "${provider.key}" serves ${provider.sport} but the data source is scoped to ${source.sportId}.`)
  }

  const context: SyncContext = { dataSourceId, now: startedAt, signal: options.signal }
  let snapshot: NormalizedSnapshot
  try {
    const raw = await provider.fetch(context)
    snapshot = provider.normalize(raw as never, context)
  } catch (error) {
    return fail(`Provider ${provider.key} failed: ${describe(error)}`)
  }
  issues.push(...snapshot.issues)

  const record = (kind: keyof SyncCounts, created: boolean) => (created ? counts[kind].created++ : counts[kind].updated++)
  const failRecord = (kind: keyof SyncCounts, entity: SyncEntityKind, externalId: string, error: unknown) => {
    counts[kind].failed++
    issues.push({ level: "error", entity, externalId, message: describe(error) })
  }

  // 1. Leagues (and the sports they need must already exist: sports are catalogue, never synced).
  const leagueIds = new Map<string, string>()
  for (const league of snapshot.leagues) {
    try {
      if (!(await syncRepository.sportExists(league.sport))) throw new Error(`Sport "${league.sport}" is not in the catalogue.`)
      const result = await syncRepository.upsertLeague(dataSourceId, league)
      leagueIds.set(league.externalId, result.id)
      record("leagues", result.created)
    } catch (error) {
      failRecord("leagues", "league", league.externalId, error)
    }
  }

  // 2. Seasons, by (leagueId, name).
  const seasonIds = new Map<string, string>()
  for (const season of snapshot.seasons) {
    try {
      const leagueId = leagueIds.get(season.leagueExternalId)
      if (!leagueId) throw new Error(`League ${season.leagueExternalId} was not synced.`)
      const result = await syncRepository.upsertSeason(leagueId, season, startedAt)
      seasonIds.set(season.externalId, result.id)
      record("seasons", result.created)
      if (result.demoted) issues.push({ level: "warning", entity: "season", externalId: season.externalId, message: "Provider marks this season current but the league already has a current season; stored as not current." })
    } catch (error) {
      failRecord("seasons", "season", season.externalId, error)
    }
  }

  // 3. Venues.
  const venueIds = new Map<string, string>()
  for (const venue of snapshot.venues) {
    try {
      const result = await syncRepository.upsertVenue(dataSourceId, venue)
      venueIds.set(venue.externalId, result.id)
      record("venues", result.created)
    } catch (error) {
      failRecord("venues", "venue", venue.externalId, error)
    }
  }

  // 4. Teams.
  const teamIds = new Map<string, string>()
  for (const team of snapshot.teams) {
    try {
      const leagueId = leagueIds.get(team.leagueExternalId)
      if (!leagueId) throw new Error(`League ${team.leagueExternalId} was not synced.`)
      const result = await syncRepository.upsertTeam(dataSourceId, leagueId, team)
      teamIds.set(team.externalId, result.id)
      record("teams", result.created)
    } catch (error) {
      failRecord("teams", "team", team.externalId, error)
    }
  }

  // 5. Players. A player without a team (individual sports) is stored with no team.
  const playerIds = new Map<string, string>()
  for (const player of snapshot.players) {
    try {
      let teamId: string | null = null
      if (player.teamExternalId !== undefined) {
        teamId = teamIds.get(player.teamExternalId) ?? null
        if (!teamId) throw new Error(`Team ${player.teamExternalId} was not synced.`)
      }
      const result = await syncRepository.upsertPlayer(dataSourceId, teamId, player)
      playerIds.set(player.externalId, result.id)
      record("players", result.created)
    } catch (error) {
      failRecord("players", "player", player.externalId, error)
    }
  }

  // 6. Matches, team-vs-team and player-vs-player alike: each side's participants are
  //    resolved through the team and player maps built above, then the row and its
  //    participant set are written. The provider's status wins; unknown keeps what is stored.
  const resolvers = { teamIds, playerIds }
  const all = [...snapshot.matches, ...(snapshot.individualMatches ?? [])].map(toPersistable)
  for (const match of all) {
    try {
      const leagueId = leagueIds.get(match.leagueExternalId)
      const seasonId = seasonIds.get(match.seasonExternalId)
      if (!leagueId) throw new Error(`League ${match.leagueExternalId} was not synced.`)
      if (!seasonId) throw new Error(`Season ${match.seasonExternalId} was not synced.`)
      const venueId = match.venueExternalId === undefined ? null : (venueIds.get(match.venueExternalId) ?? null)
      if (match.venueExternalId !== undefined && venueId === null) {
        issues.push({ level: "warning", entity: "match", externalId: match.externalId, message: `Venue ${match.venueExternalId} was not synced; stored without a venue.` })
      }
      const startsAt = new Date(match.startsAt)
      if (Number.isNaN(startsAt.getTime())) throw new Error(`Invalid start time "${match.startsAt}".`)
      if (match.loneScore) {
        issues.push({ level: "warning", entity: "match", externalId: match.externalId, message: "Only one score was provided; both scores were dropped." })
      }
      const sides = resolveSides(match.sides, resolvers)
      const result = await syncRepository.upsertMatch(
        dataSourceId,
        match.externalId,
        {
          leagueId,
          seasonId,
          venueId,
          startsAt,
          status: match.status === "unknown" ? null : matchStatus[match.status],
          stage: match.stage ?? null,
          sideAScore: sides.sideAScore ?? null,
          sideBScore: sides.sideBScore ?? null,
          liveDetail: match.status === "live" ? (match.liveDetail ?? null) : null,
        },
        sides.participants
      )
      record("matches", result.created)
    } catch (error) {
      failRecord("matches", "match", match.externalId, error)
    }
  }

  const records = Object.values(counts).reduce((sum, c) => sum + c.created + c.updated, 0)
  const failed = Object.values(counts).reduce((sum, c) => sum + c.failed, 0)
  const status: SyncStatus = failed === 0 ? "SUCCESS" : records > 0 ? "PARTIAL" : "FAILED"
  const durationMs = Date.now() - clock
  await syncRepository.finishSyncLog(syncLogId, { status, records, durationMs, error: issuesToText(issues) })
  if (status !== "FAILED") await syncRepository.markSynced(dataSourceId, startedAt)

  return { ...base(status), provider: provider.key, records, durationMs, syncLogId, error: status === "FAILED" ? "Every record failed." : undefined }
}
