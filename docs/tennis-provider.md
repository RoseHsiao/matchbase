# Tennis Provider (Sportradar Tennis API v3)

Implemented 2026-09-15 on top of the Phase 4 sync architecture (`docs/external-data-sync-architecture.md`). Adapter: `lib/data/sync/providers/sportradar-tennis.ts`, key `sportradar-tennis`, sport `tennis`, bound to the seeded DataSource `ds-tennis-sportradar` ("Sportradar Tennis") in `lib/data/sync/providers/registry.ts`.

## Provider

Sportradar Tennis API v3 (`https://api.sportradar.com/tennis`). Chosen because it identifies every player individually, including both members of a doubles competitor (`competitors[].players[]`), which the alternative feeds do not (they publish a pair as one combined name and key, which MatchBase must not treat as an identity).

Endpoints used, in order:

1. `GET {base}/{access}/v3/{lang}/competitions.json` → filter by level and type.
2. `GET …/competitions/{competition_id}/seasons.json` → keep the target year's enabled seasons.
3. `GET …/seasons/{season_id}/summaries.json?start=…&limit=200` → paged with the `X-Max-Results` header.

Trial keys allow roughly one request per second and a monthly quota; a full Grand Slam sync of one tournament (singles and doubles across genders, plus mixed) is about a dozen requests.

## Configuration

All configuration is read from the environment at sync time. Never put values in source or commit an `.env` file (`.env*` is git-ignored).

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `SPORTRADAR_API_KEY` | yes | — | Sent as the `x-api-key` header. Missing → the run fails immediately with a configuration error and makes no request. |
| `SPORTRADAR_TENNIS_ACCESS_LEVEL` | no | `trial` | `trial` or `production`; must match the key. |
| `SPORTRADAR_TENNIS_BASE_URL` | no | `https://api.sportradar.com/tennis` | Override for proxies or tests. |
| `SPORTRADAR_TENNIS_LANGUAGE` | no | `en` | Language code in the path. |
| `SPORTRADAR_TENNIS_SEASON_YEAR` | no | year of the run | Which season to sync. |
| `SPORTRADAR_TENNIS_LEVELS` | no | `grand_slam` | Comma-separated competition levels (e.g. `grand_slam,atp_1000`). |
| `SPORTRADAR_TENNIS_COMPETITIONS` | no | — | Comma-separated competition ids; when set, levels are ignored. |
| `SPORTRADAR_TENNIS_REQUEST_INTERVAL_MS` | no | `1100` | Minimum gap between requests. |

Local development: add `SPORTRADAR_API_KEY=…` to `.env.local`, run `npx prisma db seed` once so the `tennis` Sport row and the `ds-tennis-sportradar` DataSource exist, then use Admin → Data Sources → "Sportradar Tennis" → Sync now. Without a key the sync log records `FAILED: Provider sportradar-tennis failed: SPORTRADAR_API_KEY is not set …`, which is the intended behaviour; nothing is faked.

## Supported competitions

Selection is data-driven from the competitions feed: every competition whose `level` is in `SPORTRADAR_TENNIS_LEVELS` (default `grand_slam`, which covers the Australian Open, Roland-Garros, Wimbledon, and the US Open) and whose `type` is `singles`, `doubles`, or `mixed_doubles`. No tournament id is hardcoded anywhere. Other levels (ATP/WTA 1000, 500, …) work by changing the variable.

## Supported event types

Men's singles, women's singles, men's doubles, women's doubles, mixed doubles. Each is a separate Sportradar competition, so each becomes its own League (see mapping).

## Normalization mapping

| Sportradar | MatchBase (normalized) | Notes |
|---|---|---|
| competition `id` | `League.externalId` | e.g. `sr:competition:2555` |
| competition `name` | `League.name` | "Wimbledon Men Singles" |
| name + gender + type | `League.shortName` | "Wimbledon MS", "Wimbledon WD", "Wimbledon XD"; unique per tournament and type |
| `category.name` | `League.region` | "ATP" / "WTA" |
| season `id`, `year`, `start_date`, `end_date` | `Season.externalId`, `name` (the year), dates | status `current` / `upcoming` / `completed` from dates vs the run time |
| singles competitor `id`, `name`, `country` | `Player.externalId`, `name`, `nationality` | name reordered from "Last, First" to "First Last" |
| doubles competitor `players[]` `id`, `name` | one `Player` each | nationality not provided per player in the summary |
| `sport_event.venue` | `Venue` | by `venue.id` |
| `sport_event` | `NormalizedIndividualMatch` | two sides, home qualifier first |
| `round.name` | `stage` | "quarterfinal" → "Quarterfinal" |
| `sport_event_status.home_score` / `away_score` | side scores | sets won (aggregate); dropped if only one side has a score |
| `match_status` `2nd_set` | `liveDetail` "Set 2" | live matches only |

Tournament hierarchy: Sportradar groups the five event types under a parent competition (e.g. `sr:competition:2553` "Wimbledon"). MatchBase has no tournament entity, so the parent is not stored; each event type is a League and the tournament name is the common prefix. A `Tournament` model was not needed to represent the data.

## Players

Tennis players are stored as `Player` rows with `teamId = null`, which the schema allows. External identity is `(dataSourceId, externalId)` with the Sportradar competitor id, so re-syncs update the same rows. Ranking and seed are not stored (no schema support; not required).

Limitation: the user-facing Players pages and the Admin Players table currently show only players with a team (`lib/data/repositories/player-repository.ts`, `admin-repository.ts`), because the domain `Player` type still requires one. Tennis players are persisted but invisible in the UI until that domain rule is relaxed (see the participant-model analysis, open question 3).

## Singles and doubles

The normalizer keeps every participant: singles produce one player per side, doubles produce two players per side in the provider's order, with side A being the provider's `home` competitor. Nothing is collapsed into a pair or a team. This is covered by `tests/sync/sportradar-tennis.test.ts`.

Limitation: **tennis matches are not written to the database.** `Match.homeTeamId` and `awayTeamId` are `NOT NULL` foreign keys to `Team`, and inventing teams for players or pairs is ruled out. The sync service counts every normalized individual match as a failed record with one summarising sync-log line, e.g. "254 matches with player participants (127 singles, 127 doubles) were not stored: the current Match model only holds team sides." A tennis run therefore ends PARTIAL (leagues, seasons, players, venues written; matches reported), and the Data Sources page shows "Needs attention" for the feed, which is accurate.

## Status mapping

| Sportradar `status` | Normalized | Stored |
|---|---|---|
| `not_started`, `match_about_to_start`, `delayed` | upcoming | UPCOMING |
| `started`, `live`, `interrupted` | live | LIVE |
| `ended`, `closed` | finished | FINISHED |
| `cancelled`, `abandoned`, `suspended`, anything else | unknown | existing status kept (UPCOMING for a new row); warning logged; never FINISHED |

`match_status` values `walkover`, `retired`, `defaulted` arrive with `status = closed` and therefore map to finished with the sets recorded by the provider.

## External ID strategy

Unchanged from Phase 4: `(dataSourceId, externalId)` on League, Team, Player, Venue, Match with the Sportradar ids (`sr:competition:…`, `sr:season:…` via the season's year name, `sr:competitor:…`, `sr:venue:…`, `sr:sport_event:…`). Names are never used to match. Seasons reconcile by `(leagueId, name)` where the name is the year, so a competition has one season row per year.

## Errors, retries, rate limiting

- No key or an HTTP 401/403 → `ProviderConfigurationError`, run FAILED, no retry.
- HTTP 429 and 5xx → retried with backoff by the shared `fetchJson` (honouring `Retry-After`); other 4xx fail the run.
- Malformed events (missing context, competitor without identifiable players) → record-level error; the rest of the snapshot proceeds.
- Requests are serialised through a `RateLimiter` with the configured interval; each request has a 15 s timeout and up to three retries.

## Time handling

`sport_event.start_time` is an ISO 8601 instant with offset; it is passed through unchanged and would be stored as `timestamptz`. Season bounds are calendar dates. No local-time substitution anywhere; the project's presentation-timezone debt is unchanged.

## Known limitations

1. Matches are normalized but not persisted (schema); see above.
2. Persisted tennis players are hidden from the UI until team-less players are allowed by the domain type.
3. No ranking, seeding, or period (set/game) data is stored.
4. The tournament parent grouping is not stored.
5. Doubles player nationality is not available from the summaries feed (a competitor-profile call per player would be needed).
6. Real-feed verification could not be run here because no key is configured; the adapter is verified against fixtures shaped like the documented responses and the configuration-failure path is verified end to end.

## Tests

`npm test` runs `tests/sync/sportradar-tennis.test.ts` (Node's built-in test runner through `tsx`): registry and DataSource resolution, configuration failure without network access, 403 handling, competition and season selection, pagination via `X-Max-Results`, header-based authentication, singles and doubles normalization (both players per side retained), Grand Slam league mapping, player and match external ids, status mapping including cancelled, malformed-record isolation, determinism, and a regression check on the mock basketball provider.
