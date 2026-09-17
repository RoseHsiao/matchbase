# Live data integration (Phase 7)

Status: implemented 2026-09-16. The pipeline from an external sports API to the MatchBase UI is built, tested against deterministic fixtures, and exercised end to end against the real database inside rolled-back transactions. **No live Sportradar credentials have been used**: the repository contains a real provider implementation, but production API responses, authentication, data freshness and API coverage remain unverified until a key is available (section 17).

## 1. Architecture

```
External sports API
        ↓  HTTPS from the server only (lib/data/sync/utils/http.ts)
Provider adapter          lib/data/sync/providers/<name>.ts
        ↓  fetch(context)          → raw payload (private to the adapter)
        ↓  normalize(raw, context) → NormalizedSnapshot (provider-agnostic)
Sync core                 lib/data/sync/sync-core.ts  (runSync)
        ↓  validate + participant conversion (lib/data/sync/participants.ts)
Sync repository           lib/data/repositories/sync-ops.ts (createSyncRepository)
        ↓  upserts by (dataSourceId, externalId)
PostgreSQL                Prisma schema; Match + MatchParticipant
        ↓
Queries                   lib/data/queries.ts → repositories
        ↓
Next.js UI                Server Components; the browser never sees the provider
```

Raw provider types never leave the adapter file. The database is the only source of truth for the UI. The browser never calls the provider and never receives credentials: syncs run in a Server Action (`runDataSourceSync`), in `syncDataSource`, or in the manual script, all server-side.

Entry points: `lib/data/sync/sync-service.ts` (`syncDataSource`, bound to the pooled client, server-only) and `lib/data/sync/sync-core.ts` (`runSync(repository, dataSourceId, options)`, the same pipeline with an injected repository and provider resolver, used by the database tests and the manual script).

## 2. Provider abstraction

```ts
type Provider<Raw> = {
  key: string            // registry key, e.g. "sportradar-tennis"
  name: string
  sport: string          // MatchBase sport code
  kind: "live" | "mock"  // shown in Admin; never conflated
  checkConfiguration?(): { configured: true } | { configured: false; error: string }
  fetch(context): Promise<Raw>
  normalize(raw, context): NormalizedSnapshot
}
```

`NormalizedSnapshot` holds leagues, seasons, teams, players, venues, team matches (`NormalizedMatch`), player matches (`NormalizedIndividualMatch`, two `sides` of players), and issues. The registry (`lib/data/sync/providers/registry.ts`) binds a DataSource id to a provider key; nothing executable is stored in the database. `describeDataSourceProvider(id)` reports the binding, its kind, and its configuration status to Admin → Data Sources.

Registered providers: `mock-basketball` (kind `mock`, bound to `ds-mock-basketball`), `sportradar-tennis` (kind `live`, bound to `ds-tennis-sportradar`) and, since Phase 8.1, `thesportsdb-epl` (kind `live`, bound to `ds-thesportsdb-epl`; the first adapter verified against a live API, see `docs/providers/thesportsdb.md`). A configured live provider may add a one-line detail to its Admin row (`ProviderConfigurationStatus.detail`).

## 3. Environment variables

See `.env.example` (committed; the only env file that is). All are read on the server, none is prefixed `NEXT_PUBLIC_`, none is imported by client code.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `SPORTRADAR_API_KEY` | for a live sync | — | `x-api-key` header |
| `SPORTRADAR_TENNIS_ACCESS_LEVEL` | no | `trial` | `trial` or `production`, must match the key |
| `SPORTRADAR_TENNIS_BASE_URL` | no | `https://api.sportradar.com/tennis` | override for proxies or tests |
| `SPORTRADAR_TENNIS_LANGUAGE` | no | `en` | path segment |
| `SPORTRADAR_TENNIS_SEASON_YEAR` | no | year of the run | which season to sync |
| `SPORTRADAR_TENNIS_LEVELS` | no | `grand_slam` | competition levels, comma separated |
| `SPORTRADAR_TENNIS_COMPETITIONS` | no | — | explicit competition ids; overrides levels |
| `SPORTRADAR_TENNIS_REQUEST_INTERVAL_MS` | no | `1100` | minimum gap between requests |

`validateSportradarTennisConfig` checks all of them at once and produces one message listing every problem. The key's value is never included in any message.

## 4. Authentication

The key is sent only as a request header, never in a URL. HTTP 401 and 403 are turned into `ProviderConfigurationError` by the adapter (no retry). As a safeguard, any error message passing through the adapter is scrubbed of the key (`redactSecrets`), and `redactUrl` masks key-like query parameters (`api_key`, `token`, …) in every message the sync core records. Verified by tests and by a build-output scan (`grep SPORTRADAR .next/static` finds nothing).

Three states are kept apart in Admin → Data Sources:

| State | Meaning | Shown as |
|---|---|---|
| No provider | placeholder DataSource | "None (placeholder)" |
| Provider not configured | bound, but e.g. the key is missing | "Live · Not configured · SPORTRADAR_API_KEY is not set" |
| Provider configured | credentials present | "Live · Configured · credentials present, not yet verified against the live API" |

Whether a sync has ever succeeded is a separate fact: the Status column ("Needs attention" after a FAILED/PARTIAL run) and Last synced.

## 5. External identity

Every provider-owned League, Team, Player, Venue and Match is found by the composite unique `(dataSourceId, externalId)` and upserted in place; internal ids never change, so follows, watchlist rows, reminders and routes survive re-syncs. Seasons reconcile by `(leagueId, name)` (they carry no external id). Nothing is matched by name, display name, or start time.

## 6. Pagination

The tennis adapter pages `seasons/{id}/summaries.json?start=&limit=200`:

- an empty page always ends the season, whatever any header says;
- when `X-Max-Results` is a well-formed integer it decides (`start >= max` → stop), so a short page is not mistaken for the last one;
- when the header is absent or malformed, a page shorter than the limit is the last one;
- `MAX_PAGES_PER_SEASON = 50` is a hard cap, so a server that always returns a full page cannot loop;
- rows are appended in provider order, so output is deterministic for the same input.

Tests cover one page, multiple pages, an exact multiple of the page size (no extra request), an empty season, garbage metadata, an overstated total, the cap, and a missing array.

## 7. Retry and rate limiting

`lib/data/sync/utils/http.ts`:

| Failure | Classified as | Retried |
|---|---|---|
| 401, 403 | `auth` (→ configuration) | no |
| 400, 404, other 4xx | `client` | no |
| 429 | `rate-limit` | yes, honouring `Retry-After` (seconds or HTTP date, capped at `maxDelayMs`) |
| 502, 503, 504 | `server` | yes, exponential backoff |
| 500, 501 | `server` | no (not treated as transient) |
| request timeout | `timeout` | yes |
| connection failure | `network` | yes |
| 2xx with a non-JSON or non-object body | `malformed` | no |
| missing key, bad configuration | `configuration` | no request is made |

Defaults: 10 s timeout (15 s for the tennis adapter), 2 retries (3 for tennis), base delay 500 ms doubling, single wait capped at 30 s. A `RateLimiter` serialises requests with a minimum interval (1.1 s for tennis trial keys). Both the transport and the clock are injectable, so every path is unit-tested without a network or real waits.

## 8. Normalization

Adapters produce MatchBase vocabulary only: sport codes, league/season/team/player/venue records keyed by external id, and matches whose `startsAt` is an ISO 8601 instant. Record-level problems (missing context, no identifiable players, invalid start time, missing `sport_event`) become error-level issues for that record; the rest of the snapshot is unaffected.

Tennis mapping: competition → League (`tennis`), season → Season named by year, singles competitor → one Player per side, doubles `competitor.players[]` → two Players per side, `sport_event.venue` → Venue, `sport_event` → match. Names arrive as "Last, First" and are stored "First Last".

## 9. MatchParticipant mapping

Every normalized match, from any provider, becomes one `Match` row plus `MatchParticipant` rows:

| Format | Side A | Side B |
|---|---|---|
| Team sport / esports (`NormalizedMatch`) | provider home team (order 1) | provider away team (order 1) |
| Tennis singles | player (order 1) | player (order 1) |
| Tennis doubles | player (1), player (2) | player (1), player (2) |

`lib/data/sync/participants.ts` reduces both normalized shapes to one persistable form, resolves external ids to internal ids through the maps built earlier in the run, and applies the shared participant rules (`lib/data/match-participants.ts`). No `homeTeamId`/`awayTeamId`/`homeScore`/`awayScore`, no sport-specific schema, no fake teams or pairs: tennis players are stored with `teamId = null`. A changed side replaces the participant set; the match id stays.

## 10. Status mapping

Provider → `upcoming | live | finished | unknown`. `unknown` never becomes FINISHED: the stored status is kept (UPCOMING for a new row) and a warning is recorded.

Sportradar tennis (`STATUS_MAP`):

| Provider status | Normalized |
|---|---|
| `not_started`, `match_about_to_start`, `delayed` | upcoming |
| `started`, `live`, `interrupted` | live |
| `ended`, `closed` | finished |
| `cancelled`, `postponed`, `suspended`, `abandoned`, `retired`, `walkover`, empty, anything else | unknown (warning) |

Mock basketball: `SCHED` → upcoming, `INPLAY` → live, `FT` → finished, `PPD` → unknown.

## 11. Timezone handling

Providers report instants with an offset (`2026-07-04T15:00:00+02:00`). The adapter converts them to UTC ISO strings (`toInstant`), the sync stores `timestamptz`, and the UI formats for display. No zone is hardcoded in the domain; an unparseable time fails that record only. Tests cover `+02:00`, `+00:00`, `-05:00`, `Z`, and garbage.

## 12. Idempotency

Running the same snapshot twice updates the same rows: `created 0, updated n`, identical internal ids, identical participant rows, one additional SyncLog. Verified against PostgreSQL in `tests/db/sync-pipeline.test.ts`.

## 13. Partial failures

A record that cannot be normalized or persisted fails alone. The run is SUCCESS when nothing failed, PARTIAL when some records failed and others were written, FAILED when nothing was written or a stage failed. Normalization errors count as failed records, so a malformed record can never leave a run claiming SUCCESS. Verified: 2 valid + 1 malformed tennis records → PARTIAL, 2 matches persisted, the malformed id in the log.

## 14. Sync logs

One `SyncLog` per run: RUNNING → SUCCESS | PARTIAL | FAILED, `records`, `durationMs`, and `error` holding either the classified failure ("Configuration error: …", "Rate limited by the provider (retries exhausted): HTTP 429 from …") or the issue list. Admin → Sync Logs shows the first line in a Details column with the full text on hover. Credentials never appear. `DataSource.lastSyncedAt` is set only after SUCCESS or PARTIAL.

## 15. Mock vs live data

| | Mock Basketball Feed | Sportradar Tennis |
|---|---|---|
| Kind | mock | live |
| Data | deterministic fixtures relative to the run time | external API |
| Purpose | development, pipeline and regression tests, PARTIAL behaviour | production tennis data |
| Admin label | "Mock · Deterministic fixtures, never external data" | "Live · Configured / Not configured" |

Nothing ever falls back from live to mock. Seeded catalogue data (NBA, EPL, LCK, Wimbledon demo matches, …) comes from `lib/data/mock.ts` through the seed and is neither; user-facing pages stay clean, and the distinction is visible in Admin → Data Sources only.

## 16. Manual real-API smoke test

Only ever run by explicit developer action. `npm test`, `npm run build`, `npm run lint`, `npx tsc`, and the seed never call the network.

1. Put credentials in `.env.local` (git-ignored): at least `SPORTRADAR_API_KEY`, and `SPORTRADAR_TENNIS_ACCESS_LEVEL` if the key is production. Optionally narrow the scope with `SPORTRADAR_TENNIS_COMPETITIONS` or `SPORTRADAR_TENNIS_SEASON_YEAR` for a first run (trial keys are rate limited).
2. Check readiness: Admin → Data Sources → "Sportradar Tennis" should read "Live · Configured".
3. Run the sync, either from Admin → Data Sources → row menu → Sync now, or from the command line:
   ```bash
   npm run sync:manual -- ds-tennis-sportradar
   ```
   The script prints the provider, the outcome, per-entity counts, issues, and the sync log id. It exits non-zero on FAILED.
4. Inspect Admin → Sync Logs: the newest "Sportradar Tennis" run, its status and Details.
5. Verify records in Admin → Leagues (tennis competitions), Seasons, Players (team-less, "Independent"), Matches (player participants, singles and doubles).
6. Verify in the UI: Matches, Schedule, a tennis Match Detail (no Home/Away, "Player A / Player B" for doubles), a tennis player page.
7. Run it a second time and confirm the log shows updates rather than new rows.

## 17. Current limitation: no API key available

The environment used to build and verify this phase has no Sportradar key. Consequently:

- **Verified without credentials**: architecture, configuration validation, HTTP classification and retry policy, pagination, parsing of fixture responses shaped like the documented API, normalization (singles, doubles, names, scores, statuses, time zones, malformed records), participant conversion, persistence to PostgreSQL, external identity, idempotency, partial and failed runs, sync-log content, secret redaction, the Admin flow (a Sync now without a key records a FAILED "Configuration error" run).
- **Not verified**: the actual live Sportradar response shapes and field values, live authentication and access-level behaviour, data freshness, rate-limit behaviour of a real key, and how much of the real competition catalogue the adapter covers. The fixtures follow the published documentation, not observed traffic.

## 18. Future providers

Adding a feed is one adapter file, one registry entry, and one DataSource row. A team sport emits `NormalizedMatch` (home → side A, away → side B); an individual sport emits `NormalizedIndividualMatch`. Badminton or table tennis need no schema or service change. A `DataSource.provider` column, scheduling, live-score streaming, per-set scores (`MatchPeriod`), and deletion reconciliation remain deferred.
