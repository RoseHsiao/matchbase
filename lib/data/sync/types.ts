/**
 * Provider-facing contracts for external data synchronisation.
 *
 * Three layers, three vocabularies:
 * - Raw provider payloads: whatever the external API returns. Private to each
 *   adapter (the `Raw` type parameter); never seen outside `providers/`.
 * - Normalized entities (this file): provider-agnostic, keyed by the
 *   provider's own external ids, expressed in MatchBase vocabulary (sport
 *   codes, match statuses). Produced by an adapter's `normalize`.
 * - MatchBase domain rows: written by lib/data/repositories/sync-repository.ts.
 *
 * Nothing here imports Prisma or React, so adapters stay portable and testable.
 */

// ---------------------------------------------------------------------------
// Normalized entities
// ---------------------------------------------------------------------------

/** Match status in MatchBase terms. `unknown` means the adapter could not map the provider's status. */
export type NormalizedMatchStatus = "upcoming" | "live" | "finished" | "unknown"

export type NormalizedSeasonStatus = "current" | "upcoming" | "completed"

export type NormalizedLeague = {
  externalId: string
  /** MatchBase sport code (a `Sport.id`, e.g. "basketball"). The adapter owns this mapping. */
  sport: string
  name: string
  shortName: string
  region?: string
}

export type NormalizedSeason = {
  externalId: string
  leagueExternalId: string
  name: string
  /** Calendar dates, YYYY-MM-DD. */
  startsAt: string
  endsAt: string
  status: NormalizedSeasonStatus
}

export type NormalizedTeam = {
  externalId: string
  leagueExternalId: string
  name: string
  shortName: string
  /** Short abbreviation, unique within the league. */
  code: string
  color?: string
  logoUrl?: string
}

export type NormalizedPlayer = {
  externalId: string
  /** Absent for individual-sport athletes, who belong to no team. */
  teamExternalId?: string
  name: string
  handle?: string
  role?: string
  nationality?: string
  number?: number
}

export type NormalizedVenue = {
  externalId: string
  name: string
  city?: string
  country?: string
  capacity?: number
}

/**
 * A two-sided match, which is what the v1 Match model stores. For sports
 * where "home" has no meaning the adapter puts the first-listed side in
 * `homeTeamExternalId` (decisions §6). Individual-participant formats
 * (tennis, table tennis, badminton singles/doubles) cannot be expressed here;
 * adapters must report those as issues instead of inventing teams.
 */
export type NormalizedMatch = {
  externalId: string
  leagueExternalId: string
  seasonExternalId: string
  homeTeamExternalId: string
  awayTeamExternalId: string
  venueExternalId?: string
  /** Absolute instant as an ISO 8601 string with offset or Z. */
  startsAt: string
  status: NormalizedMatchStatus
  /** The provider's own status value, kept for diagnostics. */
  rawStatus?: string
  stage?: string
  homeScore?: number
  awayScore?: number
  liveDetail?: string
}

/** One competitor on a side: a team, or one player (two players make a doubles side). */
export type NormalizedSideParticipant = { kind: "team"; externalId: string } | { kind: "player"; externalId: string }

export type NormalizedSide = {
  /** In provider order; for doubles both players are kept. */
  participants: NormalizedSideParticipant[]
  /** Aggregate result for this side (sets, games, points), never period detail. */
  score?: number
}

/**
 * A match whose sides are players (singles or doubles) rather than teams.
 * The current Match row cannot store it (both sides must be teams), so the
 * sync service reports these instead of writing them. The shape is the one
 * the future participant model will persist directly
 * (docs/match-participant-model-analysis.md, §18).
 */
export type NormalizedIndividualMatch = {
  externalId: string
  leagueExternalId: string
  seasonExternalId: string
  venueExternalId?: string
  startsAt: string
  status: NormalizedMatchStatus
  rawStatus?: string
  stage?: string
  /** Side A first. For sports without home advantage the order is the provider's. */
  sides: [NormalizedSide, NormalizedSide]
  liveDetail?: string
}

export type SyncEntityKind = "provider" | "league" | "season" | "team" | "player" | "venue" | "match"

/** Something worth recording without stopping the sync. Errors mark a record as failed; warnings do not. */
export type SyncIssue = {
  level: "warning" | "error"
  entity: SyncEntityKind
  externalId?: string
  message: string
}

/** Everything one sync run received from a provider, already normalized. */
export type NormalizedSnapshot = {
  leagues: NormalizedLeague[]
  seasons: NormalizedSeason[]
  teams: NormalizedTeam[]
  players: NormalizedPlayer[]
  venues: NormalizedVenue[]
  matches: NormalizedMatch[]
  /** Player-vs-player matches, fully normalized but not storable yet. */
  individualMatches?: NormalizedIndividualMatch[]
  /** Issues found while normalizing, e.g. unsupported participant formats. */
  issues: SyncIssue[]
}

/**
 * Thrown by an adapter's `fetch` when it cannot even attempt a request:
 * missing credentials, rejected key, bad configuration. The sync service
 * records it as a FAILED run with the message.
 */
export class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProviderConfigurationError"
  }
}

// ---------------------------------------------------------------------------
// Provider adapter
// ---------------------------------------------------------------------------

export type SyncContext = {
  dataSourceId: string
  /** Reference time for the run. Adapters must not read the clock themselves. */
  now: Date
  /** Aborts in-flight requests when the run is cancelled or times out. */
  signal?: AbortSignal
}

/**
 * One external feed for one sport. A provider that serves several sports
 * registers one adapter per sport; the sync service never inspects sports.
 *
 * `fetch` talks to the outside world (pagination, retries, rate limits live
 * inside it, using utils/http.ts). `normalize` is pure.
 */
export type Provider<Raw = unknown> = {
  /** Stable key used by the registry, e.g. "mock-basketball". */
  key: string
  name: string
  /** MatchBase sport code this adapter produces data for. */
  sport: string
  fetch(context: SyncContext): Promise<Raw>
  normalize(raw: Raw, context: SyncContext): NormalizedSnapshot
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type SyncStatus = "SUCCESS" | "PARTIAL" | "FAILED"

export type SyncEntityCounts = { created: number; updated: number; failed: number }

export type SyncCounts = Record<"leagues" | "seasons" | "teams" | "players" | "venues" | "matches", SyncEntityCounts>

export type SyncResult = {
  dataSourceId: string
  provider: string | null
  status: SyncStatus
  /** Records created or updated. */
  records: number
  durationMs: number
  counts: SyncCounts
  issues: SyncIssue[]
  syncLogId: string | null
  /** Fatal error message when the run could not complete. */
  error?: string
}
