# Operational reliability and monitoring (Phase 8.4)

Status: implemented 2026-09-17. Admin → Monitoring turns the persisted sync evidence (data sources, their recent sync logs, provider readiness) into a per-source health verdict with plain-language reasons, and Sync Logs gained a kind filter and a details dialog. Nothing new is persisted, nothing alerts anyone, and no secret can reach either page.

```
Provider ──► runSync ──► SyncLog rows + DataSource.lastSyncedAt   (persisted evidence)
                               │
                               ▼
                 loadDataSourcesWithRuns  (one bounded query: every source + its 10 newest runs)
                               │
                               ▼
                 evaluateSourceHealth      (pure: freshness + execution + recent outcomes → state + reasons)
                               │
                               ▼
                 Admin → Monitoring / Data Sources / Sync Logs
```

## What the persisted data already answers

| Question | Evidence |
|---|---|
| Is the source configured? | provider registry: bound adapter and its `checkConfiguration()` |
| Is it fresh? | `DataSource.lastSyncedAt` (set on SUCCESS and PARTIAL) against the cadence |
| Is it syncing now? | latest `SyncLog.status = RUNNING` younger than the stale-lock threshold |
| When did it last succeed or fail? | newest SUCCESS/PARTIAL and newest FAILED rows |
| How long, how many records, which outcome? | `SyncLog.durationMs`, `records`, `status` |
| What failed? | `SyncLog.error`: the classified failure message or the issue list (`ERROR …` / `WARNING …` lines) |
| Are failures repeating? | consecutive FAILED rows since the last SUCCESS/PARTIAL |
| Was a run abandoned? | a FAILED row whose message starts with `Abandoned:` (written by lock recovery) |
| Was a run skipped because of the lock? | not persisted: a skip writes no row by design; it appears in the caller's result (CLI exit 3, Admin "already running", cron summary `SKIPPED_LOCKED`) |
| Which trigger started a run? | not persisted; see Limitations |

No schema change was needed. Trigger origin was evaluated and not added: it would require a migration for a column whose value is already visible at the call site, and the cron summary, CLI output and Admin banner each identify their own runs.

## Health model

`lib/data/sync/health.ts`, pure with an injected `now`. Freshness (how old the last good data is) and execution (what the latest run is doing) stay separate inputs; health is the verdict.

| State | Meaning | Attention |
|---|---|---|
| `placeholder` | no provider bound | no |
| `disabled` | `DataSource.status = INACTIVE` | no |
| `mock` | mock provider; fixtures, never a production signal | no |
| `not-configured` | live provider whose readiness check fails (missing key) | no, explained |
| `syncing` | latest run RUNNING and younger than the stale-lock threshold | no |
| `failing` | two or more consecutive FAILED runs (abandoned ones count) | yes |
| `never-synced` | no successful run yet | yes |
| `stale` | last success older than cadence + grace (27 h with the daily schedule) | yes |
| `degraded` | fresh, but the latest run FAILED, was PARTIAL, or is a RUNNING row past the stale threshold | yes |
| `healthy` | fresh and the latest run succeeded | no |

### Exact precedence

1. no provider → `placeholder`
2. disabled → `disabled`
3. mock provider → `mock`
4. provider not configured → `not-configured`
5. latest run RUNNING and younger than the stale-lock threshold → `syncing`
6. consecutive failures ≥ 2 → `failing`
7. never successfully synced → `never-synced`
8. last success beyond cadence + grace → `stale`
9. latest run RUNNING past the threshold, FAILED, or PARTIAL → `degraded`
10. otherwise → `healthy`

Why this order: a repeated failure is the strongest actionable signal even while data is still fresh, because the next data will not arrive; staleness beats a single failure because the data itself has aged; a single failure or a partial run while fresh is an incident, not an outage. Every verdict carries `reasons`, the evidence in words ("2 consecutive failed runs since the last success", "Latest failure: provider unreachable"), so an administrator never needs server logs to understand it.

## Run categories

`summarizeRun` classifies each stored row from the message prefixes the pipeline itself writes: `ok`, `issues` (with error and warning counts from the issue list), `abandoned`, `configuration`, `auth`, `rate-limit`, `server`, `client`, `timeout`, `network`, `malformed`, `unbound`, `failed`, `running`. Sync Logs shows the category as a Kind column and filter; Monitoring uses it in "Last run" and "Recent runs".

## PARTIAL

A PARTIAL run wrote data and isolated some records. It advances `lastSyncedAt`, so the source stays fresh; it makes the source `degraded` with the reason "the latest run was partial: 1 record error. 24 records were still written"; and its issue list is one click away in Sync Logs. It is never shown as success and never as total failure.

## Abandoned runs

Lock recovery (Phase 8.3) marks a RUNNING row older than 15 minutes as FAILED with the message `Abandoned: the run did not finish …`. Monitoring reads that as category `abandoned` and says "previous run died; lock recovered", distinct from `server` ("provider server error") or `network` ("provider unreachable"). A RUNNING row that is already past the threshold but not yet recovered is shown as degraded with "the next run will recover it as abandoned", never as syncing. No new status was needed.

## Failure streak

`consecutiveFailures(runs)` counts FAILED rows from the newest backwards until the first SUCCESS or PARTIAL, treating an over-age RUNNING row as a failure. Derived from the ten newest runs per source on every read; nothing is counted or cached separately, so nothing can drift.

## Queries

`lib/data/repositories/monitoring-ops.ts`: one `findMany` over data sources with a nested `take: 10` on sync logs (Prisma batches this into a single query, not one per source), and one bounded `findMany` of the 500 newest sync logs for the Sync Logs page. Health is computed from those rows at render time with the admin snapshot's `now`.

## Admin

- **Monitoring**: four summary counts over live sources (Healthy, Needs attention, Syncing, Stale), a line for what is not counted (unconfigured, mock, placeholders), a sources table (health pill with its first reason, freshness, last success, last run with its category, duration, records, auto sync) and the twelve most recent runs. Row action "Sync now" is the existing Admin action, so it runs `runSync` under the same lock and reports "Sync already running" if a run holds the source; an unconfigured or unbound source is explained instead of attempted. There is no force-unlock.
- **Data Sources**: unchanged apart from sharing the Sync now hook.
- **Sync Logs**: newest first, filters by source, entity, status and now kind; the Details column and a row action open a dialog with the full stored text.

## Redaction

Adapters scrub their own keys and `redactUrl` masks key-like query parameters, and since this phase the sync core passes every message through `redactSensitiveText` before it is stored: values of environment variables that look like secrets (`*_SECRET`, `*_TOKEN`, `*_PASSWORD`, `*_API_KEY`, `DATABASE_URL`), passwords inside connection strings, `Authorization` and API-key headers, bearer tokens, and key-like query parameters in any URL. The documented public TheSportsDB key `123` is exempt. Verified against PostgreSQL: a provider that throws a message containing an API key, a bearer token and a database password produces a SyncLog row and a monitoring row with none of them.

## Empty and non-production states

No sources → an empty state pointing at Data Sources. No live providers → "0 of 0 live sources" and the not-counted line. Not configured, mock and placeholder sources are explained in their rows and excluded from the health counts. No runs → "No runs yet" in Recent runs and "No runs" in the row.

## Tests

`tests/domain/source-health.test.ts` (categories, every state, precedence, boundaries, streaks, abandoned runs, injected now), `tests/domain/sync-redaction.test.ts`, `tests/db/monitoring-runs.test.ts` (bounded recent history, no duplicate sources, latest success and latest run, streak, PARTIAL behaviour, redaction at the persistence boundary). No test contacts a provider.

## Limitations

- Trigger origin per run is not persisted.
- A lock skip leaves no row; it is visible only to the caller that was skipped.
- Health uses the default daily cadence; a Pro deployment that tightens the schedule should set `SYNC_EXPECTED_INTERVAL_MINUTES` so freshness and health follow.
- No alerting: Monitoring is visibility inside Admin only.
