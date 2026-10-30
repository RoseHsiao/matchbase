# Production deployment runbook (Phase 9.3)

Status: written 2026-09-18 at the end of Phase 9.2, revised 2026-09-22 in Phase 9.3A (separate Neon project for Production, `bootstrap:system`, `account:create`). **No step below has been performed.** The infrastructure state and decisions are recorded in [phase-9-3a-preflight.md](phase-9-3a-preflight.md); the ordered execution for 9.3B is [phase-9-3b-plan.md](phase-9-3b-plan.md); the variable matrix is [environment-matrix.md](environment-matrix.md). Follow it in order; every step names the command or console action and what to check before moving on. Companion documents: [production hardening](../security/production-hardening.md) (why each control exists), [authentication and authorization](../security/authentication-and-authorization.md), [scheduled sync](../scheduled-sync.md), [production smoke test](production-smoke-test.md) (the verification list for steps 14 to 22).

Conventions: "operator shell" is a terminal on a trusted machine with the Production variables exported for that shell only (never written to a file in the repository); `MATCHBASE_OPERATOR_TARGET=production` is typed on each Production command, never exported globally.

## 1. Create or identify the Neon Production database

- Decision (9.3A): Production lives in its own Neon project (`matchbase-production`, same region as development), because the existing project's only branch holds the development data. Create the project, protect its default branch, note the **pooled** host (`…-pooler.…neon.tech`) and the **direct** host of that branch.
- Preview is a branch named `preview` inside the existing development project; the existing branch named `production` there is renamed `development`.
- Check: the Production project shows one empty database; the development project shows `development` and `preview`.

## 2. Create the runtime and migration credentials

- Migration/operator credential: the branch's owner role (created by Neon). Its direct connection string becomes `DATABASE_URL_UNPOOLED` in operator shells only.
- Runtime credential: after step 11 (migrations applied), run [prisma/sql/runtime-role.sql](../../prisma/sql/runtime-role.sql) as the owner role. The role name is fixed (`matchbase_app`); the only placeholder is the password. Because the Neon SQL Editor keeps a query history, use a throwaway password in the SQL, then reset the role's password from the Neon console (branch → Roles → `matchbase_app` → reset), which never passes through SQL history; use the console-issued password in `DATABASE_URL`. With psql instead, run the filled-in file with `psql -f` from a `umask 077` temp file and delete it. Never commit or paste the password.
- Build `DATABASE_URL` from the runtime role and the pooled host, ending in `?sslmode=verify-full`.
- Check (as the runtime role): `SELECT has_schema_privilege(current_user, 'public', 'CREATE')` is `false`. Later `npm run production:check -- --db` confirms it.
- If the runtime role cannot be created for any reason, deploy with the owner role for `DATABASE_URL` and record it as an open item; the readiness check will warn about identical roles.

## 3. Configure Vercel Production variables

Project → Settings → Environment Variables, scope **Production only**:

| Variable | Value |
|---|---|
| `DATABASE_URL` | runtime role, pooled host, `sslmode=verify-full` |
| `DATABASE_URL_UNPOOLED` | may be omitted on Vercel (migrations run from the operator shell); if set, the owner role, direct host |
| `MATCHBASE_DATABASE_LABEL` | `production` |
| `BETTER_AUTH_SECRET` | see step 5 |
| `BETTER_AUTH_URL` | see step 6 |
| `CRON_SECRET` | see step 7 |
| `THESPORTSDB_*` | see step 8 |
| `CSP_MODE` | leave unset (enforce) |

Must NOT be set in Production: `MATCHBASE_DEV_LOGIN`, `MATCHBASE_DEV_*`, `ALLOW_PRODUCTION_SEED`, `ALLOW_PREVIEW_PROVIDER_SYNC`, `AUTH_ALLOW_SIGN_UP` (launch policy is closed).

- Check: the variable list shows each value scoped to Production only; "Enable access to System Environment Variables" is on (needed for `VERCEL_ENV` and `VERCEL_PROJECT_PRODUCTION_URL`).

## 4. Configure Vercel Preview variables separately

Scope **Preview only**, with different values:

| Variable | Value |
|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | the Preview Neon branch (or the Neon integration's branch-per-preview), `sslmode=verify-full` |
| `MATCHBASE_DATABASE_LABEL` | `preview` |
| `BETTER_AUTH_SECRET` | a different random value |
| `CRON_SECRET` | unset (the route answers 503 on previews) |
| `ALLOW_PREVIEW_PROVIDER_SYNC` | unset (provider sync refused) |

- Check: no Production value is also scoped to Preview. Deployment Protection "Standard Protection" (Vercel Authentication) keeps preview URLs private; production domains stay public.

## 5. Configure BETTER_AUTH_SECRET

- Generate: `openssl rand -base64 32`. Store only in Vercel (Production scope). Generate a second value for Preview.
- Check: readiness check "auth-secret" passes; the value is never pasted anywhere else.

## 6. Configure BETTER_AUTH_URL and the domain

- Add the production domain to the Vercel project. With system variables enabled, `BETTER_AUTH_URL` may stay unset (derived from `VERCEL_PROJECT_PRODUCTION_URL`); set it explicitly to `https://<domain>` if the primary domain should differ from what Vercel reports.
- Check: readiness check "auth-url" shows the intended hostname and https.

## 7. Configure CRON_SECRET

- Generate: `openssl rand -base64 24`. Production scope only. Must differ from `BETTER_AUTH_SECRET` (the check refuses equal values).
- Check: `vercel.json` still schedules `/api/cron/sync` at `0 3 * * *`.

## 8. Configure provider variables

- TheSportsDB: nothing is required for the public free key; set `THESPORTSDB_API_KEY` only if you have a paid key. Optional pacing variables as in `.env.example`.
- Sportradar: leave unset unless a key exists; the source then reports "not configured" and is not scheduled.
- Check: readiness check "provider:ds-thesportsdb-epl" passes.

## 9. Verify Preview sync is disabled

- Open a preview deployment as an administrator → Admin → Data Sources → "Sync now" on any source: expect "Sync not run: Provider sync is disabled on Preview deployments".
- `curl -H "Authorization: Bearer x" https://<preview>/api/cron/sync` → 503 (no secret) or 403 (if a secret is set).

## 10. Run the production readiness check

**Sensitive variables cannot be pulled.** Vercel stores Production and Preview variables as *sensitive* by default; `vercel env pull` writes the placeholder `[SENSITIVE]` for them and `vercel env run` refuses them and silently falls back to local files (verified 2026-09-23). The operator shell therefore takes its values from their sources, never from Vercel: write a git-ignored `.env.production.local` by hand with `DATABASE_URL` and `DATABASE_URL_UNPOOLED` copied from the Neon console (project `matchbase-production`, owner role, pooled and direct hosts, `sslmode=verify-full`), `MATCHBASE_DATABASE_LABEL=production` and `BETTER_AUTH_URL=https://matchbase-drab.vercel.app`. The auth and cron secrets stay on Vercel only; the startup guard verifies their strength and separation at the first deployment, so the local readiness run reports `auth-secret` and `cron-secret` as failures that are expected in the operator shell. Keep any generated secret you may need again (the cron secret for the manual smoke test) in your password manager, not in a file. Then, with development-only keys blanked so `.env.local` cannot bleed in:

```
set -a; . ./.env.production.local; set +a
export MATCHBASE_DEV_LOGIN= MATCHBASE_DEV_USER_EMAIL= MATCHBASE_DEV_USER_PASSWORD= MATCHBASE_DEV_ADMIN_EMAIL= MATCHBASE_DEV_ADMIN_PASSWORD= NEON_BRANCH= ALLOW_PRODUCTION_SEED= ALLOW_PREVIEW_PROVIDER_SYNC= AUTH_ALLOW_SIGN_UP= CSP_MODE=
```

```
npm run production:check -- --env production
npm run production:check -- --env production --db
```

- Expect every check to pass except `auth-secret` and `cron-secret`, which the operator shell cannot see (see above). The `--db` form connects read-only with `DATABASE_URL` and reports pending migrations (expected before step 11), role privileges, stale locks, administrators, demo data.
- Nothing is printed except check lines; no secret appears.

## 11. Run Prisma Production migrations

From the operator shell, with `DATABASE_URL_UNPOOLED` on the owner role:

```
MATCHBASE_OPERATOR_TARGET=production npm run db:migrate
```

- This runs `prisma migrate deploy` only. Never `migrate dev`, `db push` or a reset against Production.
- Check: `npm run production:check -- --env production --db` now shows "all N migrations applied".
- If a migration fails: read the error, fix forward (a new migration) or mark it resolved with `npx prisma migrate resolve`, re-run; do not reset.

**Later releases that carry a migration (added 2026-10-28, Phase 11).** Vercel deploys Production on every push to `main`, and migrations are this manual step. For any build that contains a new migration:

1. migrate the Preview branch database first, before using the branch's Preview deployment;
2. migrate Production with the command above **before merging to `main`**;
3. confirm with `npm run production:check -- --env production --db` that `db-migrations`, `db-schema` and `db-table-privileges` pass;
4. only then merge.

Migrations are written to be additive, so the build already running keeps working on the migrated database. The reverse is not true: the new Prisma client reads columns the old database lacks. For `20261028080000_notification_delivery`, that breaks every session lookup.
- Then perform step 2's SQL (runtime role) if not done, and re-run the `--db` check as the runtime role.

## 11b. System bootstrap (no demo data)

After the migrations, create the rows the application needs before its first sync, from the code registries only:

```
MATCHBASE_OPERATOR_TARGET=production npm run bootstrap:system -- --dry-run
MATCHBASE_OPERATOR_TARGET=production npm run bootstrap:system
```

- Creates the six sports and one ACTIVE DataSource row per live provider (TheSportsDB Premier League, Sportradar Tennis). No mock feed, no leagues, no matches, no users. Idempotent.
- Check: "Sports created 6 … data sources created 2".

## 12. Deploy

- Push to the production branch or `vercel --prod`. The build runs `prisma generate && next build` only.
- Check the deployment log: no `[config] FAIL` lines; the server starts. A refused start shows `MatchBase refuses to start in production: <check ids>`.

## 13. Bootstrap the first ADMIN

Launch policy is closed sign-up, so the first account is created by an operator from the shell with the repository's own command (Phase 9.3A), never through the public page and never by opening sign-up:

1. `MATCHBASE_OPERATOR_TARGET=production npm run account:create -- <email> --name "<name>"` with `MATCHBASE_NEW_PASSWORD` exported for that one command (or answer the hidden prompt). The command creates a normal Better Auth email/password account as USER through Better Auth's sign-up API, discards the bootstrap session, and prints only the email, role and credential type.
2. `MATCHBASE_OPERATOR_TARGET=production npm run admin:role -- grant <email>`
3. `MATCHBASE_OPERATOR_TARGET=production npm run admin:role -- list` shows exactly the intended account.
4. Close the operator shell.
5. The person signs in at `/sign-in` with the password handed over out of band (and may change it via the operator reset later); Admin appears in the sidebar; `/admin` loads.
6. A second, regular account (or the same person signed out) sees "Administrators only" at `/admin`.

No admin email is hardcoded; nothing elevates automatically; public sign-up is never opened.

## 14. Verify auth

Smoke test sections "Anonymous" and "USER" and "ADMIN" in [production-smoke-test.md](production-smoke-test.md).

## 15. Verify Cron

- `curl -i https://<domain>/api/cron/sync` → 401. With the wrong secret → 401. With `Authorization: Bearer <CRON_SECRET>` from the operator shell → 200 with a JSON summary (this performs one real scheduled run; do it once).
- Vercel → Settings → Cron Jobs shows the job; after 03:00 UTC the next day, its log shows a 200.

## 16. Verify provider sync

- Admin → Data Sources → TheSportsDB → Sync now (one run) → a SUCCESS or PARTIAL log; a second click within 10 minutes → "Sync not run: this source synced successfully …".

## 17. Verify Monitoring

- Admin → Monitoring shows the TheSportsDB source healthy or degraded with reasons, the mock source as mock, tennis as not configured; Sync Logs shows the runs from steps 15 and 16.

## 18. Verify public routes

- Dashboard, Schedule, Matches, Teams, Players, History, a match page, a team page, a league page, `/no-such-page` (404), all anonymous.

## 19. Verify USER isolation

- Two accounts (the administrator and a regular user) in two browsers: follows and watchlist do not cross.

## 20. Verify ADMIN isolation

- The regular user: `/admin` shows "Administrators only"; a direct Server Action call (browser devtools) is answered "Only administrators can make changes."

## 21. Verify headers

```
curl -sI https://<domain>/dashboard | grep -iE 'content-security-policy|x-content-type|referrer|permissions|x-frame|strict-transport'
```

- Expect the six headers from the hardening document; the CSP carries a nonce.

## 22. Verify no secrets in the browser

- View source of `/dashboard` and the JS chunks: no `postgresql://`, no secret values, no `MATCHBASE_DEV_`; the string `BETTER_AUTH_SECRET` may appear as a variable name inside Better Auth's client code (documented in 9.1).

## 23. Rollback or stop

- Configuration mistake (server refuses to start, wrong URL): fix the variable, redeploy.
- Broken deployment: Vercel → Deployments → Instant Rollback to the previous production deployment. Cron keeps the previous schedule; a rolled-back deployment with an older schema is safe because migrations were additive.
- Suspected credential exposure: rotate `BETTER_AUTH_SECRET` (signs everyone out) and `CRON_SECRET` in Vercel, redeploy; rotate the database role password in Neon and update `DATABASE_URL`.
- Stop serving: Vercel → Settings → pause the project, or point the domain away; disable Cron Jobs in Settings → Cron Jobs.
