# Production hardening (Phase 9.2)

Status: implemented and verified locally on 2026-09-18 (tests, a production-mode `next start` smoke test, simulated readiness checks). Nothing was deployed; no Production resource exists yet. The deployment itself is Phase 9.3 and follows [deployment/production-deployment.md](../deployment/production-deployment.md).

## Re-audit: what was actually required

The Phase 9.0 findings and the Phase 9.1 carry-overs, classified against MatchBase's real shape (one Next.js app on Vercel, one Neon database, a handful of users at launch, one live provider synced daily):

| Finding | Class | Outcome in 9.2 |
|---|---|---|
| Public sign-up without email lifecycle | A | closed by default outside development; server-side |
| No password recovery | A (policy) | operator reset command; no fake flow |
| Rate limiting memory-local | A for auth endpoints | database-backed limiter on the auth endpoints |
| No security headers | A | baseline headers on every response |
| No CSP | A | nonce-based CSP, enforced |
| Owner-level runtime database role | B | least-privilege role template, readiness verification; Neon creation is an operator step |
| Preview/Production isolation configuration-dependent | A | explicit database label, startup guard, operator confirmation |
| No production config validation | A | readiness evaluation at startup and as a command |
| Seed could run against Production | A | seed refuses Production unless doubly confirmed |
| Migration workflow undefined | A | guarded `prisma migrate deploy`, operator-controlled |
| Repeated Admin "Sync now" spends provider budget | B | cooldown from run history |
| Logo URL scheme unvalidated | B (small) | https-only at both write boundaries and at render |
| Unbounded public list reads | B | watchlist reads only saved matches; list reads capped |
| Error paths log raw errors | B | one redacting log helper; 404 / error pages |
| Rate limiting on user and admin mutations | C | authentication plus idempotency is the defence; documented |
| Pagination everywhere | C | deferred; bounds documented |
| Prisma CLI transitive advisories | C | reachability documented |
| Email verification and reset flows | C until mail exists | deferred with the sign-up policy |

## Documentation verified before implementing

Read on 2026-09-18: Better Auth email/password (including `disableSignUp`, `sendResetPassword`, `revokeSessionsOnPasswordReset`), rate limiting (database storage, `rateLimit` table, key = IP + path, IP from `x-forwarded-for`, custom rules, built-in expiry of stored rows), options reference, Next.js integration; Next.js CSP guide (nonce via `proxy.ts`, dynamic rendering, `'unsafe-eval'` only in development), headers reference, instrumentation guide; Vercel environment variables (per-environment scoping, branch overrides), system environment variables (`VERCEL_ENV`), cron management (production only, `CRON_SECRET` as Bearer, no retries, best-effort delivery), response headers (HSTS `max-age=63072000` on every deployment), deployment protection (Standard Protection covers previews, production public); Neon roles and database access (SQL-created roles have only basic privileges, grant statements, default privileges); Prisma migrate deploy guidance and the Prisma 7 config reference (`datasource.url` for the CLI, `directUrl` removed, `.env` not auto-loaded).

Facts that shaped decisions: Better Auth's database rate-limit storage expires rows itself, so no cleanup job is needed; Vercel already sends HSTS; nonces require dynamic rendering, which every MatchBase page already has; Vercel cron only ever invokes Production; Prisma's own guidance is to run `migrate deploy` from automation with the direct connection, not `migrate dev` or `db push`.

## Launch sign-up policy: CLOSED

Mode A. There is no mail transport, so Mode B (verification, reset, non-enumerating responses, sender domain) cannot be built honestly. `isSignUpAllowed` (lib/auth/auth-env.ts) returns false outside local development unless `AUTH_ALLOW_SIGN_UP=true` is set explicitly; the value feeds Better Auth's `emailAndPassword.disableSignUp`, so `/api/auth/sign-up/email` answers 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED` regardless of what the page shows. The sign-up page renders "Account creation is not open" and the sign-in page says the same in its footer. Development keeps sign-up open so the form stays exercised; dev quick sign-in and the operator ADMIN grant are unaffected; the readiness check reports open sign-up in Production as a warning that names the recovery gap.

Enabling public sign-up later: add a mail transport, set `requireEmailVerification: true` with `sendVerificationEmail`, add `sendResetPassword` with `revokeSessionsOnPasswordReset: true`, wire the two forms, then set `AUTH_ALLOW_SIGN_UP=true`. No authorization code changes.

## First account and system bootstrap (Phase 9.3A)

With sign-up closed, the first Production account is created by `npm run account:create -- <email>`: Better Auth's own sign-up API on a server-side instance with sign-up allowed for that call only (same validation, same scrypt hash, same User and Account rows), role USER, the bootstrap session discarded, password from `MATCHBASE_NEW_PASSWORD` or a hidden prompt, never printed. `npm run admin:role -- grant` promotes it in a separate step. Tested end to end in `tests/db/account-create.test.ts`, including sign-in on a closed-sign-up instance and the subsequent grant.

A migrated but empty database needs only the rows the code registries define: `npm run bootstrap:system` creates the six sports (lib/sports.ts) and one ACTIVE DataSource row per live provider binding in the sync registry (no mock feed unless `--include-mock`). Leagues, seasons, clubs, venues and matches come from the first provider sync. The demo seed is never used as bootstrap. Tested in `tests/domain/system-bootstrap.test.ts` and `tests/db/system-bootstrap.test.ts`.

## Password recovery

No "Forgot password" link exists and none is faked. For the controlled first deployment, recovery is an operator procedure: `npm run account:password -- <email>` reads the new password from `MATCHBASE_NEW_PASSWORD` or a hidden prompt, hashes it with Better Auth's own `hashPassword` (scrypt, `better-auth/crypto`), verifies the hash with `verifyPassword`, writes it to the credential row, and revokes every session of the account. It prints a status line only. Against a production-labelled database it needs `MATCHBASE_OPERATOR_TARGET=production`. Tested end to end in `tests/db/account-password.test.ts`. When mail delivery exists, the built-in reset flow replaces this. Phase 10 status and the mail foundation (10.1, no runtime sending yet): [account-recovery.md](account-recovery.md).

## Rate limiting

Threat model after 9.1:

| Boundary | Abuse | Primary defence | Application limit |
|---|---|---|---|
| `/api/auth/sign-in/email` | credential stuffing, brute force | scrypt, generic errors | 10 per IP per minute |
| `/api/auth/sign-up/email` | account flooding (when open) | closed at launch | 5 per IP per hour |
| `/api/auth/request-password-reset` | enumeration, mail flooding (future) | not wired | 5 per IP per hour |
| `/api/auth/change-password` | online guessing with a stolen session | session required | 5 per IP per 10 min |
| other auth endpoints | scraping, session churn | session required | 60 per IP per minute |
| follow, watchlist, reminder actions | write spam | `requireUser`, composite keys make writes idempotent, one row per (user, target) | none |
| Admin CRUD | tampering | `requireAdmin` | none |
| Admin "Sync now" | provider budget | `requireAdmin`, lock, provider pacing | cooldown (below) |
| cron | forged triggers | `CRON_SECRET`, recency gate, lock | none |
| public reads | expensive queries | bounded lists (below) | none |

Implementation: Better Auth's limiter with `storage: "database"` (`RateLimit` table, migration `20260918064459_auth_rate_limit`), enabled whenever the environment is not development, keyed by client IP and endpoint path, IP from `x-forwarded-for` as Vercel sets it. Every serverless instance shares the table, so enforcement is consistent; Better Auth deletes expired rows on its own. Server-side `auth.api` calls bypass the limiter by design (dev quick sign-in, tests). Verified through the real HTTP handler against PostgreSQL (`tests/db/auth-rate-limit.test.ts`: ten 401s then a 429 with a retry header, one shared row, another IP unaffected) and in the production-mode smoke test (429 after the allowance). No Redis: the auth endpoints see a few requests a minute, PostgreSQL handles that with one row per key.

## Admin "Sync now" cooldown

`manualSyncPolicy` (lib/data/sync/manual-sync-policy.ts) refuses a manual run while the source's last SUCCESS or PARTIAL run is younger than `SYNC_MANUAL_COOLDOWN_MINUTES` (default 10), unless the latest run FAILED, so recovery after a failure is never blocked, and a RUNNING run is left to the lock. It reads the newest sync logs; no new state. Applied in `runDataSourceSync` after authorization and the Preview guard and before `runSync`. The cron scheduler keeps its own 30-minute recency gate for duplicate deliveries. Tested at the exact boundary; verified in the smoke test (a second click answers "Sync not run: this source synced successfully …").

## Security headers

From `lib/http/security-headers.ts` through `next.config.ts` on every response, pages and API routes alike: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()`, `X-Frame-Options: DENY`, `X-DNS-Prefetch-Control: off`, and in production mode `Strict-Transport-Security: max-age=63072000; includeSubDomains` (matching Vercel's own value; `preload` left as a conscious operator decision). Verified with curl and the smoke test.

## Content Security Policy: ENFORCED, nonce-based

Resource inventory (every MatchBase page): scripts from this origin plus the inline bootstrap scripts Next.js and next-themes emit; one compiled Tailwind stylesheet plus inline `style` attributes (team colours, sidebar geometry, Base UI positioning); images from this origin, the avatar fallbacks, and team badges from `r2.thesportsdb.com`; fonts self-hosted by next/font; fetches to this origin only (auth endpoints, Server Actions, RSC payloads). No frames, objects, third-party scripts or analytics.

Policy (lib/http/csp.ts, generated per request by proxy.ts with a fresh nonce; pages are all dynamically rendered already):

```
default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; style-src 'self' 'unsafe-inline';
img-src 'self' data: https://r2.thesportsdb.com https://www.thesportsdb.com; font-src 'self'; connect-src 'self';
worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
```

Development adds `'unsafe-eval'` to scripts (React error stacks) and `ws: wss:` to connect (hot reload). `style-src 'unsafe-inline'` is the one concession: inline style attributes cannot carry nonces and the app's colour and layout code uses them; script injection, the directive that matters, has no unsafe source. Mode comes from `CSP_MODE` (enforce by default, `report-only` for a rollback, `off` refused by the readiness check in Production). The proxy skips `/api`, static chunks and image optimisation. next-themes receives the nonce through the root layout. Verified in production mode: zero console violations across every public page, the theme switch (inline script) works, all twenty provider badges load. No reporting endpoint was added; a rollback is `CSP_MODE=report-only`.

## Image and badge URLs

`sanitizeImageUrl` (lib/safe-url.ts) accepts only absolute `https:` URLs without credentials (`http:` only when the caller opts in, which TeamLogo does outside production). Applied where a URL enters the database (Admin `saveTeam`, which rejects with "Logo URL must be an https:// image address", and the sync pipeline's team upsert, which stores null instead) and again when rendering. Existing rows: all twenty badges are https on `r2.thesportsdb.com`; demo teams have none.

## Database privileges

Runtime SQL inventory: SELECT, INSERT, UPDATE, DELETE on every table (Prisma reads and writes, Better Auth's user/session/account/verification/rateLimit rows, the sync pipeline's upserts), `SELECT … FOR UPDATE` on `DataSource` (the run lock), interactive transactions, USAGE on sequences (none today). Nothing at runtime creates, alters or drops objects, and nothing writes `_prisma_migrations`.

Strategy: two credentials. `DATABASE_URL_UNPOOLED` stays on the owner role and the direct host for `prisma migrate deploy` and operator scripts; `DATABASE_URL` becomes a SQL-created role with only the data privileges, on the pooled host. `prisma/sql/runtime-role.sql` is the auditable template (placeholders, no password), including default privileges for tables that later migrations create. Verified locally only in the negative direction: `production:check --db` reports whether the runtime role owns the database or can CREATE in `public`, and that report currently warns for the development owner role. Creating the Neon role is an operator step in the runbook; the code does not assume any Neon role name. Limitation recorded honestly: until the runbook step is done, runtime and migrations share the owner credential.

## Database URL safety

Both variables are server-only (never `NEXT_PUBLIC_`, never imported by client code; the build-output scan checks the names and the values). The runtime client (lib/data/db.ts) reads only `DATABASE_URL`; the Prisma CLI (prisma.config.ts) reads only `DATABASE_URL_UNPOOLED`; scripts prefer the direct URL and never print either. `sslmode=verify-full` is required by the readiness check. Error logging redacts connection-string passwords.

## Environment model and Preview isolation

`lib/env/runtime-environment.ts` is the single interpretation: `VERCEL_ENV` (production | preview | development), else `NODE_ENV=production` means self-hosted Production, else local development. Every policy asks it: sign-up, dev quick sign-in, provider sync on Preview, seed, operator confirmation, readiness.

The non-secret `MATCHBASE_DATABASE_LABEL` (development | preview | production) sits next to each `DATABASE_URL`. Production refuses to start unless it is `production`; Preview and development refuse to start if it is `production`; operator commands against a production-labelled database also need `MATCHBASE_OPERATOR_TARGET=production` on the command line. Code still cannot prove two URLs differ, so the runbook pairs this with Vercel variable scoping (separate Production and Preview values for the database URLs, `BETTER_AUTH_SECRET`, `CRON_SECRET`, the label) and a Neon branch per Preview.

| | Development | Preview | Production |
|---|---|---|---|
| database label | development | preview | production |
| auth secret | `.env.local` | its own | its own |
| dev quick sign-in | optional | refused | refused |
| public sign-up | open | closed | closed |
| provider sync | manual, mock | refused unless `ALLOW_PREVIEW_PROVIDER_SYNC=true` | scheduled and manual |
| `CRON_SECRET` | local smoke test | unset (route answers 503) | required |
| demo seed | allowed | allowed, noted | refused unless doubly confirmed |

## Production configuration validation

`evaluateProductionReadiness` (lib/env/production-config.ts) checks, from variables only: environment intent, database label, both database URLs (present, PostgreSQL, `verify-full`), auth secret length and entropy, auth base URL (https outside loopback), `CRON_SECRET` (required in Production, should be unset on Preview), secret separation, sign-up policy, dev-login flags and credentials absent on deployments, `ALLOW_PRODUCTION_SEED` absent, Preview-sync flag placement, `CSP_MODE`, provider configuration for the scheduled source, sync cadence values. `instrumentation.ts` runs it once per server instance: Production refuses to start on any failure, Preview only on the checks that could reach Production (label, dev login, seed flag, secret reuse). Build-time module evaluation is skipped (`NEXT_PHASE`), and the auth route stays lazy. Verified: a production-mode server with `MATCHBASE_DEV_LOGIN=true` or without the label refuses to serve (500 with the named check in the log).

## Secrets

`BETTER_AUTH_SECRET`: at least 32 characters with at least 12 distinct ones (the check rejects repeated characters), generated with `openssl rand -base64 32`. `CRON_SECRET`: at least 16 characters, generated the same way. They must differ (checked), differ between Preview and Production (runbook), never be committed (`.env*` ignored except `.env.example`; tracked-secret scan). Rotation: set the new value in Vercel for the environment, redeploy; rotating the auth secret signs every user out; rotating the cron secret needs no other change because Vercel sends whatever is configured.

## Migrations

`npm run db:migrate` runs `scripts/migrate-deploy.mts`: `prisma migrate deploy` only (never `migrate dev`, `db push` or a reset, which the script refuses by argument), with the direct connection, refused against a production-labelled database without `MATCHBASE_OPERATOR_TARGET=production`. The build no longer migrates: Vercel's build runs `prisma generate && next build`, so a Preview build can never touch a database and a Production deploy never applies schema changes implicitly. The runbook sequence is: readiness check, `db:migrate` from an operator shell against Production, then deploy. Migrations are additive so the previous deployment keeps working during the window. Failure: Prisma records the failed migration; the operator fixes and re-runs or marks it with `prisma migrate resolve`; `production:check --db` reports unfinished or pending migrations.

## Seed safety

`seedPolicy` runs first in `prisma/seed.ts`, before any connection: refused for Production intent or a production-labelled database unless `ALLOW_PRODUCTION_SEED=true` and `MATCHBASE_OPERATOR_TARGET=production` are both set; Preview is allowed with a printed note; development unchanged. Verified with `VERCEL_ENV=production npx prisma db seed` (exit 3, no connection) and in tests.

## Operator commands

| Command | Guard | Prints |
|---|---|---|
| `npm run db:migrate` | operator confirmation on production label; refuses reset/push | migration names |
| `npm run db:seed` | seed policy | anchor and counts |
| `npm run admin:role -- grant/revoke/list` | operator confirmation on production label | emails and roles |
| `npm run account:password -- <email>` | operator confirmation on production label | status line |
| `npm run sync:manual -- <id>` | operator confirmation on production label; real provider call | run summary |
| `npm run bootstrap:system [-- --include-mock] [-- --dry-run]` | operator confirmation on production label | ids and counts |
| `npm run account:create -- <email>` | operator confirmation on production label | email, role, credential type |
| `npm run production:check [--db] [--env …]` | none; read-only | check lines |

None prints a connection string, a secret or a password. Automation stays possible: the confirmation is an environment variable, not an interactive prompt.

## Error redaction and logging

`logServerError(scope, error)` (lib/logging/server-log.ts) is the one operator-log path for unexpected errors: error class and message after `redactSensitiveText`, stack only outside production. Used by the admin actions, the cron handler and the dev quick sign-in; Better Auth's logger and the sync pipeline already used the same scrubber. User-facing messages stay the short fixed strings the actions return; Next.js masks thrown Server Action messages in production. Route error pages (`app/error.tsx`, `app/global-error.tsx`) show only a digest; `app/not-found.tsx` is static.

Logging policy: safe to log are sync status, source ids, health states, redacted error categories, check ids; never logged are tokens, cookies, passwords, secrets, connection strings; emails and user ids are logged only by operator commands that act on that account. No third-party logging or analytics.

## Public error behaviour (verified in production mode)

404 page without internals; anonymous personal actions redirect to sign-in (9.1); USER at `/admin` sees "Administrators only"; failed sign-in says "Email or password is incorrect"; disabled sign-up is refused server-side with a plain page; unexpected Server Action failures return fixed messages; a provider failure only changes a source's health, public pages keep serving persisted data.

## Dependencies

`npm audit` on 2026-09-18: 4 high, unchanged from 9.0, all in the Prisma CLI's transitive dependencies (`deepmerge-ts` via `@prisma/config`, `mysql2` via `prisma`). Reachability: both packages are used by the CLI (dev-time tooling) only; the runtime client uses `@prisma/client` with the `pg` driver adapter, and `mysql2` is never loaded. Mitigation: none needed at runtime; the CLI runs in trusted operator shells and the build. Upgrade path: a Prisma release that bumps the transitives; no downgrade or forced major change. No Better Auth advisory.

## Resource bounds

Watchlist page and dashboard preview now read only the viewer's saved matches (`getWatchlistMatches`) instead of the whole catalogue. `matchRepository.findViews` applies a default limit of 1000 rows to list reads without an explicit limit (Matches, History); the admin snapshot caps matches at 5000; monitoring queries keep their 10-per-source and 500-log bounds. Cursor pagination is deferred until a provider window makes any list approach these numbers.

## Remaining risks (intentionally deferred)

- Email verification and self-service password reset until a mail transport exists.
- The least-privilege runtime role must be created by the operator (template provided); until then runtime and migrations share the owner credential.
- `style-src 'unsafe-inline'` in the CSP.
- No pagination beyond the caps above.
- Rate limiting covers auth endpoints only; user and admin mutations rely on authentication and idempotency.
- Prisma CLI transitive advisories tracked, not fixed.
- HSTS `preload` not requested.
