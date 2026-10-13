# Phase 9.3B execution plan (not executed)

Written 2026-09-22 at the end of Phase 9.3A. Every step is operator-run from a trusted shell unless it says "browser" or "Vercel dashboard". Production commands carry `MATCHBASE_OPERATOR_TARGET=production` on the command line; the shell holds the Production database URLs from a hand-written, git-ignored `.env.production.local` (Vercel's sensitive variables cannot be pulled or injected; see runbook step 10), sourced with the development-only keys blanked. Nothing here has been run.

| # | Step | Command / action | Check before continuing |
|---|---|---|---|
| 1 | Final Production preflight | `npm run production:check -- --env production` | only `auth-secret` and `cron-secret` fail (not visible in the operator shell; verified by the startup guard at step 8) |
| 2 | Recovery position | Neon → Production project → confirm the branch is protected and note the point-in-time restore window (history retention); no data exists yet, so no backup is needed before the first migration | protected = true |
| 3 | Apply migrations | `MATCHBASE_OPERATOR_TARGET=production npm run db:migrate` (uses `DATABASE_URL_UNPOOLED`, owner role, `prisma migrate deploy` only) | "All migrations have been successfully applied" |
| 4 | Verify migration status | `npx prisma migrate status` in the same shell | 6 migrations applied, none pending |
| 5 | Verify schema and runtime role | run `prisma/sql/runtime-role.sql` as the owner role if not already done; then `npm run production:check -- --env production --db` with `DATABASE_URL` on the runtime role | db-migrations PASS, db-privileges PASS, db-schema 7 of 7 |
| 6 | System bootstrap (no demo data) | `MATCHBASE_OPERATOR_TARGET=production npm run bootstrap:system` (dry run first with `-- --dry-run`) | 6 sports, 2 live data sources created; no mock feed |
| 7 | Deploy Production | push the production branch or `vercel --prod` | build runs `prisma generate && next build` only |
| 8 | Verify startup | Vercel deployment log | no `[config] FAIL`; no "refuses to start" |
| 9 | Public anonymous pages (browser) | Dashboard, Schedule, Matches, Teams, Players, History, `/no-such-page` | render; catalogue empty except sports; 404 page |
| 10 | First Production account | `MATCHBASE_OPERATOR_TARGET=production npm run account:create -- <email> --name "<name>"` with `MATCHBASE_NEW_PASSWORD` set for that invocation | "role USER, credential credential, 1 bootstrap session(s) discarded" |
| 11 | Grant ADMIN | `MATCHBASE_OPERATOR_TARGET=production npm run admin:role -- grant <email>`; then `... -- list` | exactly the intended account listed |
| 12 | Sign in as ADMIN (browser) | `/sign-in` with the password handed over out of band; change it afterwards if desired via `account:password` | sidebar shows the account and Admin |
| 13 | Admin authorization | a second browser or signed-out session: `/admin` → sign-in redirect; a USER (if any) → "Administrators only" | as described |
| 14 | One controlled TheSportsDB sync | Admin → Data Sources → TheSportsDB → Sync now (one click) | SUCCESS or PARTIAL; a second click answers the 10-minute cooldown |
| 15 | Verify SyncLog | Admin → Sync Logs | the run listed with records > 0 |
| 16 | Verify Monitoring | Admin → Monitoring | TheSportsDB healthy or degraded with reasons; tennis "not configured"; no mock source |
| 17 | Catalogue and public pages (browser) | Teams, Matches, Schedule, a match page, a team page | Premier League clubs, badges load under CSP |
| 18 | Cron secret path | `curl -i https://matchbase-drab.vercel.app/api/cron/sync` → 401; with `Authorization: Bearer <CRON_SECRET>` (the value from your password manager; if it was not kept, generate a new one and `vercel env update CRON_SECRET production < file`, then redeploy) → 200 summary (one run; the 30-minute recency gate skips the source just synced) | 401 then 200 |
| 19 | Scheduled Cron | Vercel → Settings → Cron Jobs; after 03:00 UTC next day check the log | 200 logged |
| 20 | Full smoke checklist | [production-smoke-test.md](production-smoke-test.md) | all boxes ticked |
| 21 | Headers and CSP | `curl -sI https://<domain>/dashboard` | six headers, CSP with nonce; no console violations |
| 22 | No secret leakage | view source and chunks | no `postgresql://`, no secret values, no `MATCHBASE_DEV_` |
| 23 | Record the result | append the deployment date, deployment id, migration count, admin count (not the email) to this file's "Result" section | written |

Rollback at any step: a configuration error → fix the Vercel variable and redeploy; a broken deployment → Vercel Instant Rollback; a failed migration → `npx prisma migrate resolve` after fixing forward, never a reset. Stop serving → pause the project and disable Cron Jobs.

## Result

**Performed 2026-09-24 to 2026-10-13. Production is live at https://matchbase-drab.vercel.app.**

| Fact | Value |
|---|---|
| Deployment | `matchbase-qpwrcby1l-rose-6555.vercel.app`, aliased to `matchbase-drab.vercel.app`, region `sin1` |
| Deployed commit | `82b83c4` on `main` |
| Build | READY in 58 s; `prisma generate && next build` only, no migration, seed or provider call |
| Migrations | 6 of 6 applied 2026-09-24 by `MATCHBASE_OPERATOR_TARGET=production npm run db:migrate`; `_prisma_migrations` holds exactly those six, all finished, none rolled back |
| Runtime credential | `matchbase_app` on the pooled host: cannot CREATE in `public`, does not own the database, cannot write `_prisma_migrations`, can read it |
| Migration credential | `neondb_owner` on the direct host, operator shell only |
| System bootstrap | 6 `Sport` rows and 2 live `DataSource` rows; no demo, dev or mock data at any point |
| First account | created 2026-10-13 with `account:create` as USER, bootstrap session discarded; promoted with `admin:role -- grant`; exactly 1 ADMIN |
| Public sign-up | closed throughout; the live endpoint answers `400 EMAIL_PASSWORD_SIGN_UP_DISABLED` |

### Steps satisfied by the scheduled cron rather than by a one-off run

The daily Vercel Cron job has run since the deployment, so steps 14 to 19 are evidenced by Production itself and a controlled manual sync was deliberately **not** repeated:

- **19 consecutive runs**, 2026-09-25 to 2026-10-13, every one at 03:00 UTC, **all SUCCESS**, 27 to 58 records each, about 60 s per run, zero rows carrying an error message.
- Step 14 (provider sync) and step 15 (SyncLog): the 19 rows are the evidence; `ds-thesportsdb-epl.lastSyncedAt` tracks the newest run.
- Step 16 (Monitoring) and step 17 (catalogue): the catalogue those runs produced is live and verified anonymously, 1 League (English Premier League, `externalId` 4328), 1 Season, 20 Teams with https badges, 14 Venues, 30 Matches, 60 MatchParticipants, 0 Players (the adapter syncs none). Every catalogue row carries a provider identity; none was hand-made.
- Step 18 (cron secret): the route answered 401 to a missing and a wrong bearer on 2026-09-24, proving the secret is configured; the authorized path is proven by the runs themselves.
- Step 19 (scheduled cron): 19 days of 03:00 UTC invocations.

Still open from this plan: the Monitoring and Admin pages have not been viewed as an authenticated ADMIN (database evidence only), and the ADMIN half of the smoke checklist.

### Defect found in acceptance and its resolution

**Found 2026-10-13.** Every public page that renders a kick-off time logged **React error #418** (hydration mismatch) in Production. Cause: the `Intl.DateTimeFormat` instances and the day arithmetic in `lib/format.ts` pinned no time zone, so they used the *runtime's* zone. The Vercel function runs in UTC and the visitor's browser does not, so the same instant rendered as two different strings. Measured on the live site: server HTML `11:30 AM`, hydrated DOM in Asia/Taipei `7:30 PM`; a browser forced to UTC produced no error, which isolated the cause exactly.

Impact: visitors saw UTC kick-off times at first paint before React corrected them, plus a console error on `/matches`, `/schedule`, `/history` and match detail. No data was affected and no authorization path was involved.

**Resolved in Phase 9.4** (not yet deployed): the presentation zone is now pinned on every formatter and every day boundary. See [../security/production-hardening.md](../security/production-hardening.md) for the hardening context and the Phase 9.4 notes in [../demo-data-and-time.md](../demo-data-and-time.md).
