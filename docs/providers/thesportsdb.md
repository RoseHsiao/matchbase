# TheSportsDB provider (Phase 8.1)

Status: implemented 2026-09-17 and **verified against the live TheSportsDB V1 free API** for one league, English Premier League football, through the existing provider-agnostic sync pipeline. Adapter: `lib/data/sync/providers/thesportsdb.ts`, key `thesportsdb-epl`, sport `football`, bound to the seeded DataSource `ds-thesportsdb-epl` ("TheSportsDB · Premier League"). No downstream architecture changed to fit this provider.

## Why TheSportsDB

It is a real, multi-sport, publicly reachable API with a documented free tier and stable numeric ids for leagues, teams, events and venues. That makes it the right first proof that MatchBase's sync architecture ingests an external feed as designed, without a paid key, and the right base for adding another league later through configuration.

## V1, not V2; Free, not Premium

- **V1** (`https://www.thesportsdb.com/api/v1/json/{key}/…`, key in the URL path) is used. V2 is Premium-only and is out of scope for this phase.
- The **public free key `123`** from the documentation is the default. It is configuration (`THESPORTSDB_API_KEY`), never repeated in source, and never sent to the browser.
- The documentation describes V1 as more than ten years old and less consistently named than V2. Every V1 field name (`strTeam`, `idEvent`, `strTimestamp`, …) stays inside the adapter; the rest of MatchBase sees only normalized types.

## Free tier as observed on 2026-09-17

| Endpoint (documented) | Documented free limit | Observed | Used |
|---|---|---|---|
| `lookupleague.php?id=4328` | 1 | 1 league, 47 fields, carries `strCurrentSeason` | yes |
| `search_all_seasons.php?id=4328` | – | only the five oldest seasons (1992 to 1996) | no; the current season comes from the league |
| `search_all_teams.php?l=English_Premier_League` | 10 | 10 of 20 clubs | yes, then per-club `lookupteam.php` for the rest |
| `lookupteam.php?id=…` | 1 | 1 team with `strTeamShort`, colours, badge | yes, for clubs missing from the list |
| `eventsseason.php?id=4328&s=2026-2027` | 15 | 15 events on the first call, **5 on every later call**, always the earliest of the season | yes |
| `eventsnextleague.php?id=4328` | 1 | 1 event | yes |
| `eventspastleague.php?id=4328` | 1 | 1 event | yes |
| `eventsday.php?d=…&l=4328` | 3 | up to 3 per day, `null` on days without matches | yes, one call per day of a window |
| `lookupevent.php?id=…` | 1 | 1 event, same shape as the listings | evaluated, not used |
| `lookupvenue.php?id=…` | 1 | 1 venue with capacity | evaluated, not used (would cost one request per venue) |
| `lookup_all_teams.php?id=…` | not documented | returned 24 clubs including League One sides | **not used**: undocumented and wrong |
| rate limit | 30 requests/minute | no `Retry-After` or rate headers on 200 responses | defaults stay at 24/minute |

**Consequence.** The free tier cannot deliver a full season schedule. A run assembles: the league, the listed clubs, the season list (5 to 15 early-season events), the next and previous event, and up to three events per day for a window of days around the run (default two days back, seven ahead), then looks up the clubs that only appear in events. That is the honest shape of the data; MatchBase does not claim the season is complete.

## Requests per run and rate-limit strategy

Base calls 5 + one per window day (default 10) + one per club missing from the team list (10 on the first run) = 25 by default. Defaults: `THESPORTSDB_REQUEST_INTERVAL_MS=2500` (24 requests/minute through the shared `RateLimiter`), `THESPORTSDB_MAX_REQUESTS=28` as a hard per-run budget. When the budget is reached, remaining day calls stop and remaining clubs are created from event data with a warning in the sync log; nothing exceeds the budget. Transport is the shared `fetchJson`: 15 s timeout, **one** retry after a 5 s pause for 429 and 5xx (honouring `Retry-After`, capped at 30 s), no retry for other 4xx. Requests are sequential; there is no fan-out. Two real runs took 84 s and 72 s.

## Configuration

Environment (`.env.example`): `THESPORTSDB_API_KEY` (default `123`), `THESPORTSDB_BASE_URL`, `THESPORTSDB_REQUEST_INTERVAL_MS`, `THESPORTSDB_PAST_DAYS`, `THESPORTSDB_FUTURE_DAYS`, `THESPORTSDB_MAX_REQUESTS`, `THESPORTSDB_SEASON` (override; default the league's `strCurrentSeason`). All read on the server; none is `NEXT_PUBLIC_`.

Source binding (`lib/data/sync/providers/registry.ts`): `createTheSportsDbProvider({ key, name, sport, leagueId, shortName? })`. The Premier League source is `{ key: "thesportsdb-epl", sport: "football", leagueId: "4328" }`. A second compatible league is another call with another `leagueId`, a registry binding, and a DataSource row; no adapter change. The adapter checks the feed's `strSport` against the source's sport (`SPORT_MAP`: Soccer → football, Basketball, Tennis) and refuses a mismatch as a configuration error.

Admin → Data Sources shows the source as `Live · Configured · public free V1 key · league 4328 · at most 28 requests per run, 24/min · free tier truncates listings`, distinct from the mock feed ("Mock") and from Sportradar ("Live · Not configured").

## Normalized mapping

| TheSportsDB | MatchBase | Notes |
|---|---|---|
| league `idLeague` | `League.externalId` | `4328` |
| `strLeague` | `League.name` | "English Premier League" |
| first `strLeagueAlternate` entry | `League.shortName` | "Premier League"; the demo league keeps "EPL" so the `(sportId, shortName)` unique holds. Overridable per source |
| `strCountry` | `League.region` | |
| `strCurrentSeason` | `Season.name` and external id | "2026-2027"; window derived: split-year → 1 July to 30 June, single year → calendar year (the free tier exposes no season dates) |
| team `idTeam` | `Team.externalId` | |
| `strTeam` | `Team.name`, `Team.shortName` | |
| `strTeamShort` | `Team.code` | fallback: first three letters of the name, made unique within the snapshot with a numeric suffix |
| `strColour1`, `strBadge` | `Team.color`, `Team.logoUrl` | empty colour → null; badges are served from TheSportsDB's CDN |
| event `idEvent` | `Match.externalId` | |
| `idHomeTeam` | participant side A, order 1 | `Sport.homeAway` for football makes the UI label it Home |
| `idAwayTeam` | participant side B, order 1 | labelled Away |
| `intHomeScore`, `intAwayScore` | `sideAScore`, `sideBScore` | strings parsed to integers; a lone score is dropped by the sync core with a warning |
| `intRound` | `Match.stage` | "Matchweek 5" |
| `idVenue`, `strVenue`, `strCountry`, `strCity` | `Venue` | from the event; `strCity` is usually empty |
| `strStatus`, `strPostponed` | `Match.status` | see below |
| `strTimestamp` (or `dateEvent` + `strTime`) | `Match.startsAt` | see below |

Players are not synced in this phase (`lookup_all_players.php` is capped at 10 per team on the free tier and was not needed for the match journey).

## Status mapping

Observed live: `NS` and `FT` only. The rest of the table follows the feed's football status codes (the payload carries API-Football ids, whose code vocabulary TheSportsDB mirrors) and is fixture-tested, not live-verified.

| `strStatus` | Normalized |
|---|---|
| `NS` | upcoming |
| `1H`, `HT`, `2H`, `ET`, `BT`, `P`, `LIVE`, `INT` | live, with a phase label as live detail |
| `FT`, `AET`, `PEN` | finished |
| `PST`, `CANC`, `ABD`, `AWD`, `WO`, `SUSP`, `TBD`, empty, null, anything else, or `strPostponed = "yes"` | unknown: the stored status is kept (UPCOMING for a new row) and a warning is logged; never finished or upcoming by guess |

## Timestamps

`strTimestamp` is `YYYY-MM-DDTHH:mm:ss` with no zone designator, and `dateEvent` + `strTime` split the same value. They are UTC: the same events carry `strTimeLocal` exactly one hour later for English clubs in British Summer Time (19:00 vs 20:00), and the documentation calls `strTime` UTC. The adapter appends `Z`, falls back to `dateEvent` + `strTime`, respects an explicit offset if one ever appears, and fails a record whose time is missing or malformed rather than assuming midnight (old seasons carry `strTime = null` and a midnight placeholder). Provider instants are never touched by the demo clock; the seed only addresses its own ids.

## External identity and data ownership

Rows are found by `(dataSourceId, externalId)` with the numeric ids; names are never used to match. The provider's Arsenal (`133604`) is a different row from the demo `arsenal`, deliberately: the architecture has no cross-provider identity, so entities are not merged by name. **Duplication implication:** while the demo catalogue and this source coexist, the Teams page shows two Premier League groups ("Football · Premier League" from the demo, "Football · English Premier League" from TheSportsDB) and both an "Arsenal" in each. Verified across two live runs: 1 league, 1 season, 20 teams, 8 venues, 23 matches and 46 participants created on the first run, everything updated in place on the second with identical ids, and the 23 demo matches, demo leagues, demo teams and the 8 mock-basketball matches byte-identical before and after.

## Failure behaviour

| Failure | Result |
|---|---|
| network failure, timeout | one retry, then the run FAILS classified `network` / `timeout` |
| HTTP 429 | one retry after `Retry-After` or 5 s, then FAILED `rate-limit` |
| HTTP 5xx | one retry, then FAILED `server` |
| HTTP 4xx | no retry, FAILED `client` |
| malformed JSON, non-object body | FAILED `malformed` |
| valid JSON with a missing or `null` collection | empty list, run continues |
| event without teams, with the same team twice, or without a usable time | that record fails; run is PARTIAL |
| event from another league or season | skipped with a warning |
| unknown status | stored status kept, warning |
| team without a name | record error; rescued from event data when an event names it |
| request budget reached | day calls stop, remaining clubs built from event data, warnings |
| custom key in a transport error message | scrubbed |

## Manual sync

```bash
npm run sync:manual -- ds-thesportsdb-epl
```

The same pipeline the Admin "Sync now" action runs. It prints the provider, outcome, per-entity counts, issues and the sync log id, and exits non-zero on FAILED. Nothing else contacts the API: `npm test`, `npm run build`, `npm run lint` and the seed never do.

## Fixtures and tests

`tests/sync/fixtures/thesportsdb.ts` holds sanitized captures (real ids and names, trimmed fields, shortened artwork URLs) and an in-memory V1 that answers the documented paths and can fail on demand. `tests/sync/thesportsdb.test.ts` covers configuration, endpoint construction, request order and budget, league, season, team, venue and event normalization, sides, scores, statuses, timestamps, nulls, malformed records, other-league and other-season events, failure classification and determinism. `tests/db/thesportsdb-pipeline.test.ts` runs the real pipeline into PostgreSQL inside rolled-back transactions: ownership, sides, no merge with the demo Arsenal, idempotent second run, PARTIAL on a malformed event.

## Verified live versus fixture-only

- **Live-verified (two real runs on 2026-09-17):** endpoint construction and key placement, the free-tier limits above, parsing of every field the adapter reads, `NS` and `FT` statuses, UTC timestamps, team lookups, venue extraction, badge URLs, external identity, idempotency, the 24/min pacing without a single 429.
- **Fixture-only:** every status code other than `NS` and `FT` (no match was live during the runs), 429 and 5xx handling, malformed bodies, the request-budget cut-off, a custom key.

## Known limitations

- The free tier truncates every listing, so coverage is a window, not a season; the early-season list even shrank from 15 to 5 between calls.
- No live match was observed, so the live phase labels are untested against real payloads.
- Players, lineups, tables and per-venue details are not synced.
- Season dates are derived, not provided.
- A run takes about 75 s because it is deliberately paced.
- Provider rows are never deleted or archived; a cancelled fixture stays with its last known status.
