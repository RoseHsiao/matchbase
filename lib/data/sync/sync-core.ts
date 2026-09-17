import type { SyncRepository } from "@/lib/data/repositories/sync-ops"
import { resolveSides, toPersistable } from "@/lib/data/sync/participants"
import { resolveProvider as resolveFromRegistry } from "@/lib/data/sync/providers/registry"
import {
  ProviderConfigurationError,
  type NormalizedMatch,
  type NormalizedSnapshot,
  type Provider,
  type SyncContext,
  type SyncCounts,
  type SyncEntityKind,
  type SyncErrorKind,
  type SyncIssue,
  type SyncOutcome,
  type SyncResult,
  type SyncStatus,
} from "@/lib/data/sync/types"
import { redactSensitiveText } from "@/lib/data/sync/redaction"
import { classifyError, redactUrl } from "@/lib/data/sync/utils/http"
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
 * Failures are classified (`SyncErrorKind`) so the log and the admin UI can
 * say "set the API key" or "the provider is rate limiting us" instead of a
 * generic "sync failed". Messages never contain credentials: adapters redact
 * their own secrets and URLs are scrubbed of key-like query parameters.
 *
 * Outcome: FAILED when nothing could be written (or the run aborted),
 * PARTIAL when some records failed, SUCCESS otherwise. Warnings (unknown
 * statuses, demoted seasons) are stored in the log's `error` column as notes
 * but do not change a SUCCESS outcome.
 *
 * The repository and the provider resolver are injected so the same code
 * runs in the application (lib/data/sync/sync-service.ts) and in the
 * database tests inside a rolled-back transaction.
 */

const SYNC_LOG_ENTITY = "all"
const MAX_ERROR_LENGTH = 2000
/** A RUNNING log older than this belongs to a dead process: a real run finishes in minutes, and the cron function is cut off at 300 s. */
export const SYNC_LOCK_STALE_MS = 15 * 60_000

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
  const message = error instanceof Error ? error.message : String(error)
  return redactUrl(message)
}

/** A stage failure, worded for operators: what kind of problem and where it happened. */
export function describeSyncFailure(stage: "fetch" | "normalize", provider: string, error: unknown): { kind: SyncErrorKind; message: string } {
  const detail = describe(error)
  if (error instanceof ProviderConfigurationError) return { kind: "configuration", message: `Configuration error: ${detail}` }
  if (stage === "normalize") return { kind: "malformed", message: `Provider ${provider} returned data the adapter could not normalize: ${detail}` }
  const kind = classifyError(error)
  const label: Record<typeof kind, string> = {
    auth: "Authentication rejected by the provider",
    "rate-limit": "Rate limited by the provider (retries exhausted)",
    server: "Provider server error (retries exhausted)",
    client: "Provider rejected the request",
    timeout: "Provider request timed out (retries exhausted)",
    network: "Could not reach the provider (retries exhausted)",
    malformed: "Provider returned a malformed response",
    unknown: `Provider ${provider} failed`,
  }
  return { kind: kind === "auth" ? "configuration" : kind, message: `${label[kind]}: ${detail}` }
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
  /** Provider lookup; defaults to the registry. Tests inject fixture-backed adapters here. */
  resolveProvider?: (dataSourceId: string) => Provider<never> | undefined
  /** Age after which a RUNNING log is treated as abandoned. */
  staleLockMs?: number
  /** Environment whose secret values are scrubbed from every stored message; defaults to the process environment. */
  env?: Record<string, string | undefined>
}

export async function runSync(repository: SyncRepository, dataSourceId: string, options: SyncOptions = {}): Promise<SyncResult> {
  const startedAt = options.now ?? new Date()
  const clock = Date.now()
  const counts = emptyCounts()
  const issues: SyncIssue[] = []
  // Persistence boundary: nothing reaches SyncLog without this pass, whatever an adapter or driver put in a message.
  const scrub = (text: string | null): string | null => (text === null ? null : redactSensitiveText(text, options.env ?? process.env))
  const base = (status: SyncOutcome, extra: Partial<SyncResult> = {}): SyncResult => ({
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

  const source = await repository.findDataSource(dataSourceId)
  if (!source) return base("FAILED", { error: `Data source "${dataSourceId}" does not exist.`, errorKind: "no-provider" })

  // One run per source at a time, across processes: the RUNNING log is the lock (see sync-ops.acquireSyncLog).
  const lock = await repository.acquireSyncLog(dataSourceId, SYNC_LOG_ENTITY, startedAt, options.staleLockMs ?? SYNC_LOCK_STALE_MS)
  if (!lock.acquired) {
    return base("SKIPPED", { syncLogId: lock.syncLogId, error: `A sync started at ${lock.activeSince.toISOString()} is still running; skipped.`, errorKind: "locked" })
  }
  const syncLogId = lock.syncLogId
  if (lock.recovered > 0) issues.push({ level: "warning", entity: "provider", message: `${lock.recovered} abandoned run${lock.recovered === 1 ? "" : "s"} marked failed before this run.` })
  const fail = async (error: string, errorKind: SyncErrorKind, provider: string | null = null): Promise<SyncResult> => {
    const safe = scrub(error) ?? error
    await repository.finishSyncLog(syncLogId, { status: "FAILED", records: 0, durationMs: Date.now() - clock, error: safe })
    return base("FAILED", { syncLogId, error: safe, errorKind, provider })
  }

  const provider = (options.resolveProvider ?? resolveFromRegistry)(dataSourceId)
  if (!provider) return fail("No provider is registered for this data source.", "no-provider")
  if (source.sportId && source.sportId !== provider.sport) {
    return fail(`Provider "${provider.key}" serves ${provider.sport} but the data source is scoped to ${source.sportId}.`, "configuration", provider.key)
  }
  const readiness = provider.checkConfiguration?.()
  if (readiness && !readiness.configured) {
    return fail(`Configuration error: ${readiness.error}`, "configuration", provider.key)
  }

  const context: SyncContext = { dataSourceId, now: startedAt, signal: options.signal }
  let raw: unknown
  try {
    raw = await provider.fetch(context)
  } catch (error) {
    const failure = describeSyncFailure("fetch", provider.key, error)
    return fail(failure.message, failure.kind, provider.key)
  }
  let snapshot: NormalizedSnapshot
  try {
    snapshot = provider.normalize(raw as never, context)
  } catch (error) {
    const failure = describeSyncFailure("normalize", provider.key, error)
    return fail(failure.message, failure.kind, provider.key)
  }
  issues.push(...snapshot.issues)
  // A record the adapter could not normalize is a failed record: it keeps the run from
  // claiming SUCCESS (PARTIAL when the rest was written), exactly like a persistence failure.
  const countKey: Partial<Record<SyncEntityKind, keyof SyncCounts>> = { league: "leagues", season: "seasons", team: "teams", player: "players", venue: "venues", match: "matches" }
  for (const issue of snapshot.issues) {
    const key = issue.level === "error" ? countKey[issue.entity] : undefined
    if (key) counts[key].failed++
  }

  const record = (kind: keyof SyncCounts, created: boolean) => (created ? counts[kind].created++ : counts[kind].updated++)
  const failRecord = (kind: keyof SyncCounts, entity: SyncEntityKind, externalId: string, error: unknown) => {
    counts[kind].failed++
    issues.push({ level: "error", entity, externalId, message: describe(error) })
  }

  // 1. Leagues (and the sports they need must already exist: sports are catalogue, never synced).
  const leagueIds = new Map<string, string>()
  for (const league of snapshot.leagues) {
    try {
      if (!(await repository.sportExists(league.sport))) throw new Error(`Sport "${league.sport}" is not in the catalogue.`)
      const result = await repository.upsertLeague(dataSourceId, league)
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
      const result = await repository.upsertSeason(leagueId, season, startedAt)
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
      const result = await repository.upsertVenue(dataSourceId, venue)
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
      const result = await repository.upsertTeam(dataSourceId, leagueId, team)
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
      const result = await repository.upsertPlayer(dataSourceId, teamId, player)
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
      const result = await repository.upsertMatch(
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
  await repository.finishSyncLog(syncLogId, { status, records, durationMs, error: scrub(issuesToText(issues)) })
  if (status !== "FAILED") await repository.markSynced(dataSourceId, startedAt)

  return {
    ...base(status),
    provider: provider.key,
    records,
    durationMs,
    syncLogId,
    error: status === "FAILED" ? "Every record failed." : undefined,
    errorKind: status === "FAILED" ? "records" : undefined,
  }
}
