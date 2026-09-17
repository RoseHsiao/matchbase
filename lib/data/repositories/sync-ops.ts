import type { ParticipantInput } from "@/lib/data/match-participants"
import type {
  NormalizedLeague,
  NormalizedPlayer,
  NormalizedSeason,
  NormalizedTeam,
  NormalizedVenue,
  SyncStatus,
} from "@/lib/data/sync/types"
import type { Prisma } from "@/lib/generated/prisma/client"
import type { MatchStatus as DbMatchStatus, SeasonStatus as DbSeasonStatus } from "@/lib/generated/prisma/enums"

/**
 * Database writes for synchronisation, built over any Prisma client (the
 * application singleton, or a transaction the tests roll back). Every
 * provider-owned row is found by
 * its external identity `(dataSourceId, externalId)` and upserted, so a
 * second run updates the same rows and internal ids never change.
 *
 * Seasons are the exception: the schema gives them no external identity, so
 * they reconcile by the league-scoped unique key `(leagueId, name)`.
 *
 * Participants are owned by their match and carry no external identity; a
 * match write reconciles them as a set (section 18 of the participant-model
 * analysis): unchanged sets are left alone, changed sets are replaced.
 *
 * Each call is one atomic statement or a short sequence. There is
 * deliberately no run-wide transaction: a provider snapshot can be large and
 * slow to fetch, and a failed record should not roll back the ones that
 * succeeded. Partial outcomes are recorded as PARTIAL in the sync log instead.
 */

export type Upserted = { id: string; created: boolean }

const seasonStatus: Record<NormalizedSeason["status"], DbSeasonStatus> = {
  current: "CURRENT",
  upcoming: "UPCOMING",
  completed: "COMPLETED",
}

function isoDate(value: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must be YYYY-MM-DD, got "${value}".`)
  return new Date(`${value}T00:00:00.000Z`)
}

function sameParticipants(existing: { side: string; order: number; teamId: string | null; playerId: string | null }[], next: ParticipantInput[]): boolean {
  if (existing.length !== next.length) return false
  const key = (p: { side: string; order: number; teamId?: string | null; playerId?: string | null }) => `${p.side}:${p.order}:${p.teamId ?? ""}:${p.playerId ?? ""}`
  const a = existing.map(key).sort()
  const b = next.map(key).sort()
  return a.every((value, index) => value === b[index])
}

/** The subset of the client the sync writes need; a `$transaction` client satisfies it. */
export type SyncClient = Pick<Prisma.TransactionClient, "dataSource" | "sport" | "league" | "season" | "team" | "player" | "venue" | "match" | "matchParticipant" | "syncLog" | "$queryRaw">

/** Runs `work` in a short database transaction. Omitted when the client already is one (tests). */
export type TransactionRunner = <T>(work: (tx: SyncClient) => Promise<T>) => Promise<T>

export type SyncRepositoryOptions = { transaction?: TransactionRunner }

export type SyncRepository = ReturnType<typeof createSyncRepository>

/** What lock acquisition reports: the new RUNNING log, or the run that still holds the source. */
export type SyncLockResult =
  | { acquired: true; syncLogId: string; recovered: number }
  | { acquired: false; syncLogId: string; activeSince: Date; recovered: number }

export function createSyncRepository(db: SyncClient, options: SyncRepositoryOptions = {}) {
  const inTransaction: TransactionRunner = options.transaction ?? ((work) => work(db))
  return {
  findDataSource(id: string) {
    return db.dataSource.findUnique({ where: { id }, select: { id: true, name: true, sportId: true, status: true } })
  },

  async sportExists(sportId: string): Promise<boolean> {
    return (await db.sport.count({ where: { id: sportId } })) > 0
  },

  async upsertLeague(dataSourceId: string, league: NormalizedLeague): Promise<Upserted> {
    const where = { dataSourceId_externalId: { dataSourceId, externalId: league.externalId } }
    const existing = await db.league.findUnique({ where, select: { id: true } })
    const data = { sportId: league.sport, name: league.name, shortName: league.shortName, region: league.region ?? null }
    const row = await db.league.upsert({ where, create: { ...data, dataSourceId, externalId: league.externalId }, update: data, select: { id: true } })
    return { id: row.id, created: !existing }
  },

  /** Reconciled by (leagueId, name). Keeps the one-current-season rule by demoting a clashing incoming season. */
  async upsertSeason(leagueId: string, season: NormalizedSeason, now: Date): Promise<Upserted & { demoted: boolean }> {
    const where = { leagueId_name: { leagueId, name: season.name } }
    const existing = await db.season.findUnique({ where, select: { id: true } })
    let status = seasonStatus[season.status]
    let demoted = false
    if (status === "CURRENT") {
      const clash = await db.season.count({ where: { leagueId, status: "CURRENT", ...(existing ? { id: { not: existing.id } } : {}) } })
      if (clash > 0) {
        status = isoDate(season.endsAt, "Season end") < now ? "COMPLETED" : "UPCOMING"
        demoted = true
      }
    }
    const data = { startsAt: isoDate(season.startsAt, "Season start"), endsAt: isoDate(season.endsAt, "Season end"), status }
    const row = await db.season.upsert({ where, create: { leagueId, name: season.name, ...data }, update: data, select: { id: true } })
    return { id: row.id, created: !existing, demoted }
  },

  async upsertTeam(dataSourceId: string, leagueId: string, team: NormalizedTeam): Promise<Upserted> {
    const where = { dataSourceId_externalId: { dataSourceId, externalId: team.externalId } }
    const existing = await db.team.findUnique({ where, select: { id: true } })
    const data = { leagueId, name: team.name, shortName: team.shortName, code: team.code.toUpperCase(), color: team.color ?? null, logoUrl: team.logoUrl ?? null }
    const row = await db.team.upsert({ where, create: { ...data, dataSourceId, externalId: team.externalId }, update: data, select: { id: true } })
    return { id: row.id, created: !existing }
  },

  /** `teamId` null for individual-sport athletes. */
  async upsertPlayer(dataSourceId: string, teamId: string | null, player: NormalizedPlayer): Promise<Upserted> {
    const where = { dataSourceId_externalId: { dataSourceId, externalId: player.externalId } }
    const existing = await db.player.findUnique({ where, select: { id: true } })
    const data = { teamId, name: player.name, handle: player.handle ?? null, role: player.role ?? null, nationality: player.nationality ?? null, number: player.number ?? null }
    const row = await db.player.upsert({ where, create: { ...data, dataSourceId, externalId: player.externalId }, update: data, select: { id: true } })
    return { id: row.id, created: !existing }
  },

  async upsertVenue(dataSourceId: string, venue: NormalizedVenue): Promise<Upserted> {
    const where = { dataSourceId_externalId: { dataSourceId, externalId: venue.externalId } }
    const existing = await db.venue.findUnique({ where, select: { id: true } })
    const data = { name: venue.name, city: venue.city ?? null, country: venue.country ?? null, capacity: venue.capacity ?? null }
    const row = await db.venue.upsert({ where, create: { ...data, dataSourceId, externalId: venue.externalId }, update: data, select: { id: true } })
    return { id: row.id, created: !existing }
  },

  /**
   * Upsert the match row by external identity, then reconcile its
   * participants. `status` null keeps the stored status (unknown provider
   * status); a new row defaults to UPCOMING.
   */
  async upsertMatch(
    dataSourceId: string,
    externalId: string,
    data: {
      leagueId: string
      seasonId: string
      venueId: string | null
      startsAt: Date
      status: DbMatchStatus | null
      stage: string | null
      sideAScore: number | null
      sideBScore: number | null
      liveDetail: string | null
    },
    participants: ParticipantInput[]
  ): Promise<Upserted> {
    const where = { dataSourceId_externalId: { dataSourceId, externalId } }
    const existing = await db.match.findUnique({ where, select: { id: true, participants: { select: { side: true, order: true, teamId: true, playerId: true } } } })
    const { status, ...rest } = data
    const rows = participants.map((p) => ({ side: p.side, order: p.order, teamId: p.teamId ?? null, playerId: p.playerId ?? null }))

    if (!existing) {
      const row = await db.match.create({
        data: { ...rest, status: status ?? "UPCOMING", dataSourceId, externalId, participants: { create: rows } },
        select: { id: true },
      })
      return { id: row.id, created: true }
    }

    await db.match.update({ where: { id: existing.id }, data: { ...rest, ...(status ? { status } : {}) }, select: { id: true } })
    if (!sameParticipants(existing.participants, participants)) {
      // Replace the set. Without a client-side transaction the two statements are not atomic;
      // the unique constraints still reject a half-written duplicate, and the next run repairs the set.
      await db.matchParticipant.deleteMany({ where: { matchId: existing.id } })
      await db.matchParticipant.createMany({ data: rows.map((r) => ({ ...r, matchId: existing.id })) })
    }
    return { id: existing.id, created: false }
  },

  /**
   * Takes the per-source run lock by creating the RUNNING sync log, atomically.
   *
   * The DataSource row is locked `FOR UPDATE` inside one short transaction, so
   * two processes (two serverless invocations, an Admin click during a cron
   * run, the CLI) serialise here: the second sees the first's RUNNING log
   * and gets `acquired: false`. The RUNNING row *is* the durable lock, so it
   * survives the process; a RUNNING row older than `staleAfterMs` is an
   * abandoned run (a killed or timed-out process), marked FAILED here and
   * counted in `recovered`, so a crash can never lock a source for good. The
   * row lock is held only for these few statements, never for the sync.
   */
  async acquireSyncLog(dataSourceId: string, entity: string, startedAt: Date, staleAfterMs: number): Promise<SyncLockResult> {
    return inTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "DataSource" WHERE "id" = ${dataSourceId} FOR UPDATE`
      const staleBefore = new Date(startedAt.getTime() - staleAfterMs)
      const abandoned = await tx.syncLog.updateMany({
        where: { dataSourceId, status: "RUNNING", startedAt: { lt: staleBefore } },
        data: { status: "FAILED", durationMs: staleAfterMs, error: `Abandoned: the run did not finish within ${Math.round(staleAfterMs / 60_000)} minutes and was marked failed by a later run.` },
      })
      const active = await tx.syncLog.findFirst({ where: { dataSourceId, status: "RUNNING" }, select: { id: true, startedAt: true }, orderBy: { startedAt: "desc" } })
      if (active) return { acquired: false, syncLogId: active.id, activeSince: active.startedAt, recovered: abandoned.count }
      const row = await tx.syncLog.create({ data: { dataSourceId, entity, records: 0, status: "RUNNING", startedAt }, select: { id: true } })
      return { acquired: true, syncLogId: row.id, recovered: abandoned.count }
    })
  },

  async finishSyncLog(id: string, outcome: { status: SyncStatus; records: number; durationMs: number; error: string | null }): Promise<void> {
    await db.syncLog.update({ where: { id }, data: outcome })
  },

  async markSynced(dataSourceId: string, at: Date): Promise<void> {
    await db.dataSource.update({ where: { id: dataSourceId }, data: { lastSyncedAt: at } })
  },
  }
}
