# External Data Sync Architecture

Phase 4 (implemented 2026-09-15). Server-side ingestion from external providers into the existing PostgreSQL domain model, without touching the read path, the UI, or the Prisma schema.

## Status

- Implemented: provider contract, HTTP utilities, sync service, sync repository, provider registry, one deterministic mock provider, an Admin "Sync now" action.
- Not implemented (deferred): a real provider, scheduling, background workers, live-score push, a `provider` column on `DataSource`, a `MatchParticipant` model.

## Pipeline

```
External provider
  ↓ Provider.fetch(context)          lib/data/sync/providers/<adapter>.ts   (pagination, retries, rate limit via utils/http.ts)
Raw provider payload                 private to the adapter
  ↓ Provider.normalize(raw, context) same adapter, pure
NormalizedSnapshot                   lib/data/sync/types.ts   (provider-agnostic, MatchBase vocabulary, external ids)
  ↓ syncDataSource()                 lib/data/sync/sync-service.ts   (orchestration, issue collection, outcome)
  ↓ syncRepository.upsert*           lib/data/repositories/sync-repository.ts   (Prisma upserts by external identity)
PostgreSQL                           the same rows the app and Admin already read
```

Boundaries that must hold:

| Layer | May know about | Must not know about |
|---|---|---|
| Adapter (`providers/*`) | its provider's payload, its sport, MatchBase sport codes and statuses | Prisma, React, other providers |
| Sync service | the `Provider` contract, normalized types, the sync repository | any sport, any provider payload, UI |
| Sync repository | Prisma, external identity keys | providers, sports |
| `queries.ts`, page components, generic repositories | nothing about sync | provider shapes |

## Provider contract

```ts
type Provider<Raw> = {
  key: string      // registry key, e.g. "mock-basketball"
  name: string
  sport: string    // MatchBase Sport.id this adapter produces
  fetch(context: SyncContext): Promise<Raw>
  normalize(raw: Raw, context: SyncContext): NormalizedSnapshot
}
```

One adapter serves one sport. A provider covering several sports registers one adapter per sport. The sync service iterates entities generically; there is no `if (sport === …)` anywhere in the pipeline. Sport-specific decisions (which side is "home", how a status maps, whether a fixture format is representable) live in the adapter.

`SyncContext` carries `dataSourceId`, the run's reference time `now` (adapters must not read the clock), and an optional `AbortSignal`.

## Registry and DataSource binding

`lib/data/sync/providers/registry.ts` holds two maps: provider key → adapter, and DataSource id → provider key. The `DataSource` model has no provider column yet; adding one is the correct long-term home and needs a migration, so it is deferred and the binding is code for now. A DataSource with no binding cannot sync and gets a FAILED log saying so.

The seed adds one DataSource, `ds-mock-basketball` ("Mock Basketball Feed", basketball), bound to the mock adapter. The other seeded sources (NBA, LCK, EPL, VCT, ESL feeds, Manual Import) remain unbound placeholders.

## Sync lifecycle

`syncDataSource(dataSourceId, { now?, signal? })`:

1. Load the DataSource. Missing → FAILED result, no log (the log needs the FK).
2. Create a `SyncLog` with status `RUNNING`, entity `"all"`, `startedAt = now`.
3. Resolve the adapter; refuse if none is bound or if the adapter's sport differs from the source's sport scope → FAILED.
4. `fetch` then `normalize`. Any throw → FAILED with the message.
5. Upsert in dependency order, each record independently, collecting issues:
   leagues (sport must exist in the catalogue; sports are never synced) → seasons → venues → teams → players → matches.
6. Outcome: `SUCCESS` if no record failed; `PARTIAL` if some failed and some were written; `FAILED` if nothing was written.
7. Finish the log: status, `records` (created + updated), `durationMs`, `error` = the issue list (errors and warnings, newline separated, capped at 2000 characters) or null.
8. On SUCCESS or PARTIAL, set `DataSource.lastSyncedAt = now`.

The Admin Sync Logs page shows these rows as before; a "Full sync" filter option was added for entity `"all"`. The Data Sources page derives "Needs attention" from the latest log being FAILED or PARTIAL, so a feed with record failures surfaces there automatically.

## External identity and reconciliation

Provider-owned rows are found by `(dataSourceId, externalId)`, the composite unique already on League, Team, Player, Venue, and Match. A hit updates the row in place (the internal id never changes, so follows, watchlist entries, and routes keep working); a miss creates a row with a database-generated id. Names are never used to match provider records.

Season is the one exception: the schema gives it no external identity, so it reconciles by the league-scoped unique key `(leagueId, name)`. The provider's season `externalId` is only used to link matches within a run.

Nothing is deleted. A record absent from one snapshot stays in the database. Destructive reconciliation is out of scope.

## Idempotency

Running the same sync twice writes the same rows: upserts keyed by external identity, seasons by `(leagueId, name)`, and a mock provider whose fixtures are derived from the run's reference time rounded to the hour. Verified by running the mock sync twice and comparing table counts and ids.

## Match status

The provider is the source of truth. Adapters map their vocabulary to `upcoming | live | finished`; anything else is `unknown`.

| Mock provider state | Normalized | Stored |
|---|---|---|
| `SCHED` | upcoming | UPCOMING |
| `INPLAY` | live | LIVE |
| `FT` | finished | FINISHED |
| `PPD` (or any unmapped value) | unknown | existing status kept; UPCOMING for a new row; warning recorded |

An unknown status is never mapped to FINISHED. Scores are stored only when both are present; a lone score is dropped with a warning. `liveDetail` is stored only for live matches. The frontend does not infer status from the clock; it displays what is stored.

## Time handling

Adapters hand over ISO 8601 instants; the service parses them with `new Date()` and stores `timestamptz`, so UTC is preserved and nothing is converted to a local zone during sync. Season bounds are calendar dates. The existing presentation debt (day boundaries use the server's local time; Asia/Taipei display is a documented decision not yet implemented) is unchanged by this phase.

## Errors, retries, rate limits

- `utils/http.ts` provides `fetchJson` (timeout via `AbortSignal.timeout`, bounded exponential-backoff retries, `Retry-After` support), `withRetry`, and a `RateLimiter` enforcing a minimum interval between requests. Adapters compose them; the mock adapter pages its fixtures through the limiter to exercise the path.
- Fetch and normalize errors abort the run as FAILED. Record-level errors (missing parent, invalid date, same team on both sides, database constraint) fail that record only.
- No job queue, cron, or worker exists. `syncDataSource` is a plain server function callable from a Server Action today and from a scheduler later.

## Transaction boundaries

Each upsert is its own atomic statement. There is no run-wide transaction: a remote snapshot can be slow to fetch, a long transaction would hold locks and risk Prisma's interactive-transaction timeout, and a single bad record should not undo the good ones. The trade-off is that a run can leave a partially updated snapshot, which is exactly what the PARTIAL status and the issue list report.

## Multi-sport extensibility

Basketball, football, volleyball, League of Legends, Valorant and other team-vs-team formats fit the current `Match` row directly; for sports without a home side the adapter places the first-listed side in `homeTeamExternalId`, and the UI already labels sides from `Sport.homeAway`. Adding such a provider is: one adapter file, one registry entry, one DataSource row. No change to the service, repositories, queries, or UI.

## Tennis, table tennis, badminton

The `Match` model is team-vs-team (`homeTeamId` / `awayTeamId` → `Team`). Singles are player-vs-player and doubles are pairs; neither is a `Team`. An adapter for these sports must not create fake teams from players to make a sync pass. The intended handling until a `MatchParticipant` model exists: the adapter emits a `SyncIssue` (level `warning`, entity `match`) for each fixture it cannot represent and omits it from `matches`. The normalized types already carry that path (`NormalizedSnapshot.issues`). This is a documented limitation of v1, not a Phase 4 redesign.

## Admin integration

Data Sources row menu → "Sync now" → Server Action `runDataSourceSync(id)` → `syncDataSource` → `refresh()`. The result appears as a banner (info on success or partial, error on failure) and in the Sync Logs page. Credentials never leave the server (none exist yet).

## Plugging in a real provider

1. Add `lib/data/sync/providers/<name>.ts` exporting a `Provider<YourPayload>`; put credentials in environment variables read inside `fetch`.
2. Register it in `providers/registry.ts` and bind a DataSource id.
3. Seed or create the DataSource row (name, sport scope).
4. Run "Sync now" and read the sync log.

## Deferred

Real provider; `DataSource.provider` column; scheduling and background execution; live-score streaming; per-entity sync scopes; deletion or archival reconciliation; `MatchParticipant`; provider credential storage beyond environment variables.
