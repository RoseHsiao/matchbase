# Scheduled sync and data freshness (Phase 8.3)

Status: implemented 2026-09-17. Provider-owned data is now kept fresh by a Vercel Cron Job that calls one authenticated route, which runs a provider-neutral scheduler, which calls the same single-source pipeline the CLI and Admin "Sync now" already use. A database-backed lock makes concurrent invocations safe. Nothing in this phase touches demo-owned data.

## Vercel constraints, verified 2026-09-17

From the official documentation (`/docs/cron-jobs`, `/docs/cron-jobs/manage-cron-jobs`, `/docs/cron-jobs/usage-and-pricing`, `/docs/functions/limitations`):

| Fact | What it means here |
|---|---|
| Cron invocations are HTTP `GET` requests to the production deployment, user agent `vercel-cron/1.0`, header `x-vercel-cron-schedule` | The route is a plain App Router `GET` handler |
| `CRON_SECRET` is sent as `Authorization: Bearer <secret>`; recommended at least 16 random characters | The route compares it in constant time and refuses to run without it |
| Cron expressions are **always UTC**; no `MON`/`JAN` aliases; day-of-month and day-of-week cannot both be set | The schedule is written in UTC and documented in Taipei time as well |
| **Hobby**: 100 cron jobs, minimum interval **once per day**, fired anywhere within the scheduled hour (±59 min); more frequent expressions fail deployment. **Pro/Enterprise**: once per minute, per-minute precision | The committed schedule is daily so it deploys on either plan |
| Vercel **does not retry** a failed invocation; delivery is best effort: a run can be **missed** or **delivered twice** | The scheduler is idempotent and has a recency gate |
| Vercel **can trigger a second instance while the first is still running**; the docs tell you to lock | The RUNNING sync log is a cross-process lock |
| Max duration with Fluid compute (default for new projects): **Hobby 300 s default and maximum**; Pro/Enterprise 300 s default, 800 s maximum | `maxDuration = 300`, scheduler budget 240 s |
| Cron jobs are not triggered by `next dev` or `vercel dev`; call the route yourself locally | Local smoke test below |
| Cron jobs do not follow redirects; a new deployment does not interrupt a running job; Instant Rollback keeps the previous schedule | Route returns JSON directly |

## Architecture

```
Vercel Cron (0 3 * * * UTC)
     │  GET, Authorization: Bearer CRON_SECRET
     ▼
/api/cron/sync                       app/api/cron/sync/route.ts   (Node.js, maxDuration 300)
     │  lib/api/cron-sync.ts: authenticate → invoke → JSON summary
     ▼
Scheduled Sync Orchestrator          lib/data/sync/scheduler.ts   (provider-neutral, injectable)
     ├── eligibility   active + live provider + configured
     ├── recency gate  skip if last success < 30 min ago (duplicate deliveries)
     └── time budget   stop starting sources after 4 min
              │
              ▼
       runSync()                     lib/data/sync/sync-core.ts   (the single-source pipeline)
              ├── acquire lock       sync-ops.acquireSyncLog: DataSource row FOR UPDATE → RUNNING SyncLog
              ├── provider registry → fetch → normalize
              ├── repositories      upsert by (dataSourceId, externalId)
              └── finish SyncLog    SUCCESS | PARTIAL | FAILED, lastSyncedAt
              │
              ▼
          PostgreSQL (Neon)
```

Every trigger reaches the same function:

```
CLI  npm run sync:manual ──┐
Admin "Sync now" ──────────┼──► runSync(repository, dataSourceId)
Cron → scheduler ──────────┘
```

The CLI (`scripts/sync-data-source.mts`) and Admin (`lib/data/admin-actions.ts` → `lib/data/sync/sync-service.ts`) already converged on `runSync` before this phase; the scheduler calls it through `syncDataSource` (`lib/data/sync/scheduled-sync-service.ts`). There is no second pipeline and no second logging system: the scheduler summarises outcomes, the pipeline writes the sync logs.

## Source eligibility

`isSchedulable(source, provider)` in `lib/data/sync/scheduler.ts`. A source is scheduled automatically when all three hold:

1. `DataSource.status` is `ACTIVE` (a disabled source is skipped);
2. a provider is bound to it in the registry (placeholders are skipped);
3. the provider's `kind` is `live` **and** its `checkConfiguration()` reports configured (mock feeds and an unconfigured Sportradar are skipped).

No provider is named. No schema change was needed: status, the registry binding and the provider's own readiness check express the distinction. Today exactly one source qualifies, `ds-thesportsdb-epl`. Admin shows each source's verdict ("Auto: daily" or "Auto: off · reason").

## Cadence

`vercel.json` registers `0 3 * * *`: **daily at 03:00 UTC**, which is 11:00 in Asia/Taipei, fired by Vercel anywhere between 03:00 and 03:59 UTC on Hobby. Rationale:

- Hobby permits nothing more frequent; a more frequent expression fails deployment, so a daily schedule is the deployment-safe choice.
- TheSportsDB's free tier delivers a window of fixtures (up to seven days ahead) and results (two days back), so a daily refresh keeps the demo current for the way the data is actually served; a run costs 25 paced requests and about 75 s.
- 03:00 UTC is after the last European evening kick-off has finished and before the Taipei working day, so the morning view shows last night's results.

On a Pro plan the same route can run every six hours with `0 */6 * * *`; the scheduler, lock and freshness code need no change, only `SYNC_EXPECTED_INTERVAL_MINUTES=360` so Admin measures freshness against the new cadence.

Configuration in `lib/data/sync/schedule-config.ts`, overridable in minutes through `SYNC_EXPECTED_INTERVAL_MINUTES`, `SYNC_FRESHNESS_GRACE_MINUTES`, `SYNC_MIN_INTERVAL_MINUTES`, `SYNC_TIME_BUDGET_MINUTES`, `SYNC_STALE_LOCK_MINUTES`.

## Runtime and duration

`app/api/cron/sync/route.ts` declares `runtime = "nodejs"` (Prisma over PostgreSQL) and `maxDuration = 300`. 300 s is the Hobby maximum and the default on every plan with Fluid compute, and it is sufficient: the verified TheSportsDB run takes 72 to 84 s, and the scheduler stops starting new sources once its 4-minute budget is spent, so a single invocation always returns inside the limit even if several sources become eligible. Nothing larger is requested.

## Authentication

`lib/api/cron-sync.ts`:

- The secret comes only from `CRON_SECRET` in the environment. It is never in source, never in the client bundle (the route is server-only), never logged, never echoed in a response.
- Without a configured secret of at least 16 characters the route answers **503** and does nothing; an open sync endpoint would be worse than no cron.
- The `Authorization: Bearer …` value is compared against the secret in **constant time** (`timingSafeEqual` over SHA-256 digests, so unequal lengths are safe). Missing or wrong: **401** `{"ok":false,"error":"Unauthorized."}`.
- Vercel's user agent marks the run as trigger `cron`; any other authorised caller is trigger `manual` (the local smoke test).

## Concurrency: the run lock

`acquireSyncLog` in `lib/data/repositories/sync-ops.ts`, used by `runSync` for every trigger:

1. In one short transaction, lock the source's `DataSource` row with `SELECT … FOR UPDATE`. Two processes acquiring at the same instant serialise here, whatever machine they run on.
2. Mark any `RUNNING` sync log for the source older than the stale threshold (15 min) as `FAILED` with an "Abandoned" message. That is the **stale-lock recovery**: a process killed mid-run (a timed-out function, a lost container) leaves a RUNNING row, and the next run takes over after the threshold instead of waiting forever. The threshold is safely above the 300 s function limit and the observed 84 s run.
3. If a `RUNNING` log remains, return `acquired: false`; `runSync` then returns `status: "SKIPPED"` with `errorKind: "locked"` and writes **no** log row.
4. Otherwise insert the `RUNNING` log and commit. The row lock is released with the commit, after milliseconds; the RUNNING log is the durable lock for the whole run and is released by `finishSyncLog` on success, partial or failure (every exit path of `runSync`).

Why this is safe with Vercel and Neon: the lock is a database row, not process memory, so any number of serverless instances see the same state. The row lock is held inside a single short transaction, which is correct through Neon's pooled connection (PgBouncer transaction mode) because the whole acquisition is one transaction. PostgreSQL advisory locks were evaluated and rejected: transaction-level ones would need the transaction to span the whole 80-second run, and session-level ones are not reliable through a transaction-mode pooler where the session can change between statements.

Different sources use different rows, so they never block each other. Verified against the real database from two independent connections in `tests/db/sync-lock.test.ts`: acquire and release on success, a concurrent second invocation skips, two simultaneous acquisitions let exactly one through, release after failure, stale recovery, independent sources.

## Freshness model

`lib/data/sync/freshness.ts`, pure with an injected `now`:

- `getDataSourceFreshness({ lastSuccessfulSyncAt, expectedIntervalMs, graceMs, now })` → `never` (no successful run), `fresh` (age ≤ interval + grace) or `stale` (age beyond it). With the daily cadence and a 3-hour grace (Hobby's 59-minute window plus run time), a source becomes stale 27 hours after its last successful run.
- `getSyncExecutionState(latestLog)` → `idle`, `syncing` (latest log RUNNING) or `failed` (latest FAILED or PARTIAL). Execution state is deliberately separate from freshness.

Freshness describes the source. It is never inferred from match timestamps, and no component computes `Date.now() - lastSyncedAt` on its own.

## Admin

Admin → Data Sources gains a **Freshness** column per bound source: `fresh (2 h old)`, `stale (31 h old)` or `never synced`, with `· syncing now` or `· last run failed` when the latest log says so, and a second line `Auto: daily` or `Auto: off · <reason>`. Freshness uses the admin snapshot's `now`, so server and client agree. Sync Logs already lists every run, including abandoned ones marked failed by the lock recovery. Admin "Sync now" during a running sync reports "Sync already running" instead of starting a second one.

## Failure isolation and idempotency

The scheduler runs sources sequentially and records one outcome per source: `SUCCESS`, `PARTIAL`, `FAILED`, `SKIPPED_LOCKED`, `SKIPPED_RECENT`, `SKIPPED_BUDGET`, `INELIGIBLE`. A failure, a lock or an exception in one source never stops the next. Failures are logged once, by the pipeline; the scheduler only summarises.

Repeated invocations are safe: the pipeline upserts by `(dataSourceId, externalId)` so a second run updates rather than duplicates; the recency gate skips a source whose last successful sync is under 30 minutes old, which absorbs Vercel's occasional duplicate delivery; the lock prevents two runs of one source at once. No id is derived from an invocation.

## Data ownership

The scheduler reads `DataSource` rows and calls the provider pipeline. It never runs the seed, never touches demo matches, follows or watchlists, and never writes rows owned by another source, because the pipeline only addresses rows by the syncing source's own id. The demo clock (`lib/demo-clock.ts`) is not involved anywhere in this path.

## Environment variables for Vercel

| Variable | Production | Preview | Development | Notes |
|---|---|---|---|---|
| `DATABASE_URL` | required | required (a Neon branch) | `.env.local` | pooled; `sslmode=verify-full` |
| `DATABASE_URL_UNPOOLED` | required (build runs `prisma migrate deploy`) | required | `.env.local` | direct |
| `CRON_SECRET` | required | optional (cron only runs on production) | `.env.local` for the smoke test | random, at least 16 characters; the route refuses to run without it |
| `THESPORTSDB_*` | optional | optional | optional | defaults use the public free key; see `.env.example` |
| `SYNC_*_MINUTES` | optional | optional | optional | cadence tuning; defaults match `vercel.json` |
| `SPORTRADAR_*` | optional | optional | optional | unset means the tennis source is not schedulable |
| `ALLOW_PREVIEW_PROVIDER_SYNC` | unset | unset unless the preview owns its database branch | unset | since Phase 9.1 a Preview deployment answers 403 to the cron route (after the secret check) and refuses Admin "Sync now" unless this is `true`; see [security/authentication-and-authorization.md](security/authentication-and-authorization.md) |

None is `NEXT_PUBLIC_`; the built client bundle is scanned for `CRON_SECRET` and provider configuration strings as part of validation.

## Local smoke test

```bash
# .env.local (git-ignored): CRON_SECRET=<random string of at least 16 characters>
npm run dev
curl -i http://localhost:3000/api/cron/sync                                  # → 401
curl -i -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/sync   # → 200 JSON summary
```

The authorised call runs every eligible source for real (today: one TheSportsDB run of about 75 s), then Admin → Sync Logs shows the run and Admin → Data Sources shows the source as fresh. Do not repeat it merely for testing; the free tier is shared.

## Tests

- `tests/sync/scheduler.test.ts`: eligibility rules, discovery, isolation of failures and exceptions, locked outcome, recency gate, time budget, sequential order, summary counts.
- `tests/domain/freshness.test.ts`: never, fresh, stale, exact boundary, injected `now`, labels, execution state, cadence configuration.
- `tests/api/cron-sync.test.ts`: missing, wrong, prefix and wrong-scheme auth rejected, missing secret refused, valid auth invokes the scheduler exactly once, secret never echoed, crash is a safe 500.
- `tests/db/sync-lock.test.ts`: the lock against PostgreSQL from two connections (see above).

None calls TheSportsDB or Vercel.

## Limitations

- The committed cadence is daily because Hobby allows nothing more frequent; freshness is therefore measured in hours, not minutes. Pro deployments can tighten it through configuration.
- Sources run sequentially inside one invocation; with several long-running sources the time budget would defer some to the next day. A second cron entry or a queue would be the next step, not needed for one source.
- A stale lock is recovered after 15 minutes; a genuinely running sync longer than that is impossible under the 300 s limit, but the threshold is configurable.
- Missed cron deliveries are not retried by Vercel; the next day's run catches up because the pipeline is reconciliation-based.
- Deeper operational monitoring (run history charts, alerting) is Phase 8.4.
