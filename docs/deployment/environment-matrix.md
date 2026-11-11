# Environment variable matrix (Phase 9.3A, mail variables added in Phase 10.1, unverified sign-up flag 2026-11-10)

Written 2026-09-22 from the code that reads each variable (`lib/env/runtime-environment.ts`, `lib/env/production-config.ts`, `lib/auth/auth-env.ts`, `lib/auth/dev-login.ts`, `lib/http/csp.ts`, `lib/data/sync/schedule-config.ts`, the provider adapters). No values appear here. "Scope" is the Vercel environment the variable is set for; "shell" means it is exported in an operator terminal for one command and never stored on Vercel.

Legend: **R** required, **O** optional, **F** forbidden (the readiness check fails or the feature refuses), — not used.

| Variable | Secret | Purpose | Development (`.env.local`) | Preview | Production |
|---|---|---|---|---|---|
| `DATABASE_URL` | yes | runtime connection, pooled host, `sslmode=verify-full`; the least-privilege runtime role in Production and Preview. The only connection the deployed application uses | R (dev branch, owner role acceptable) | R (Preview branch: `matchbase_app` on `<endpoint>-pooler`, database `matchbase_preview`) | R (Production project, runtime role) |
| `DATABASE_URL_UNPOOLED` | yes in an operator shell; yes in the Vercel Production scope; **no** in the Vercel Preview scope, which holds a placeholder with no user name and no password (no credential) | direct connection for `prisma migrate deploy` and operator scripts; exactly `sslmode=require&sslaccept=strict&channel_binding=require`, the parameters Prisma's migration engine honours (it ignores `verify-full`). `prisma.config.ts` also reads it while `prisma generate` runs in the build, where only a non-empty value is needed | R | **Vercel:** R, but only the **build-only placeholder** below (no user name, no password). **Operator shell:** the real owner direct URL, only in `~/.config/matchbase/preview.env`, used through `preview.sh` | **Operator shell:** the owner direct URL. **Vercel Production:** currently also set, and **required for now** because the build's `prisma generate` needs a non-empty value; its actual value was not verified in the 2026-11-10 audit; do not remove it without option B or an approved Production change ([production-deployment.md](production-deployment.md) step 3). The Preview build-only placeholder policy does **not** apply to Production |
| `MATCHBASE_DATABASE_LABEL` | no | which database the URLs point at; must equal the environment intent | R `development` | R `preview` | R `production` |
| `MATCHBASE_DATABASE_ENDPOINT` | no | the Neon endpoint id (`ep-…`) both connection strings must use: `DATABASE_URL` on `<endpoint>-pooler`, `DATABASE_URL_UNPOOLED` on `<endpoint>` (lib/env/database-identity.ts). Independently, any non-Production environment pointing at a Production endpoint fails | O | R (**missing or mismatched blocks the Preview from starting**) | R once set; until then a **warning**, not a failure, so Production is not taken down before the operator sets it; a mismatch fails |
| `MATCHBASE_OPERATOR_TARGET` | no | per-command confirmation for a production-labelled database | — | — | shell only, `production`, never on Vercel |
| `BETTER_AUTH_SECRET` | yes | signs session cookies; 32+ random characters, 12+ distinct | R (local value) | R (its own value) | R (its own value, different from Preview and from `CRON_SECRET`) |
| `BETTER_AUTH_URL` | no | auth base URL; derived from Vercel system variables when unset | O (unset; inferred per request) | O (unset; derived from `VERCEL_URL`) | O (derived from `VERCEL_PROJECT_PRODUCTION_URL`) or R as `https://<custom domain>` when the primary domain differs |
| `AUTH_ALLOW_SIGN_UP` | no | requests public sign-up. Outside development it is honoured with deliverable verification mail (then **verification required**, Phase 10.7), or together with `AUTH_ALLOW_UNVERIFIED_SIGN_UP=true` (open **unverified**). Alone, without mail, it is refused and the readiness check / startup guard **fails** | O (unset means open in development) | absent (closed); set together with the next row only for an unverified sign-up test | absent (closed) until the operator decides; open-unverified needs both rows ([production-hardening.md](../security/production-hardening.md#public-sign-up-without-email-verification-2026-11-10)) |
| `AUTH_ALLOW_UNVERIFIED_SIGN_UP` | no | the operator's explicit acceptance that sign-up opens **without** email verification (no address check, no self-service recovery, sign-up reveals existing addresses). Effective only with `AUTH_ALLOW_SIGN_UP=true` and no verification mail; alone it **fails** readiness and blocks startup; ignored in development | — (ignored) | absent, or `true` together with `AUTH_ALLOW_SIGN_UP=true` | absent; `true` only together with `AUTH_ALLOW_SIGN_UP=true`, after the checklist in production-deployment.md |
| `CRON_SECRET` | yes | bearer token for `/api/cron/sync` and `/api/cron/notifications` (Phase 11, not scheduled yet); 16+ random characters | O (local smoke test only) | F (absent; the route answers 503), **except** a temporary, branch-scoped, Preview-only value for the reminder check in the Preview procedure; remove it afterwards | R (its own value) |
| `MATCHBASE_DEV_LOGIN` | no | dev quick sign-in switch | O | F (absent) | F (absent; presence blocks startup) |
| `MATCHBASE_DEV_USER_EMAIL` | no | dev USER account | O | F | F |
| `MATCHBASE_DEV_USER_PASSWORD` | yes | dev USER password | O | F | F (presence blocks startup) |
| `MATCHBASE_DEV_ADMIN_EMAIL` | no | dev ADMIN account | O | F | F |
| `MATCHBASE_DEV_ADMIN_PASSWORD` | yes | dev ADMIN password | O | F | F (presence blocks startup) |
| `ALLOW_PREVIEW_PROVIDER_SYNC` | no | lets a Preview run provider syncs | — | F for launch (absent) | — (no effect; absent) |
| `ALLOW_PRODUCTION_SEED` | no | lets the demo seed run against Production | — | — | F on Vercel (presence blocks startup); shell only if ever intended |
| `CSP_MODE` | no | `enforce` (default), `report-only` (rollback), `off` (fails Production) | O | O | O (unset = enforce) |
| `CSP_IMAGE_HOSTS` | no | extra https image origins | O | O | O |
| `THESPORTSDB_API_KEY` | yes | TheSportsDB V1 key; the public free key is the default | O | O | O (set only with a paid key) |
| `THESPORTSDB_BASE_URL` | no | provider base URL | O | O | O |
| `THESPORTSDB_REQUEST_INTERVAL_MS`, `THESPORTSDB_PAST_DAYS`, `THESPORTSDB_FUTURE_DAYS`, `THESPORTSDB_MAX_REQUESTS`, `THESPORTSDB_SEASON` | no | pacing, window, budget, season | O | O | O (defaults keep the free-tier budget) |
| `SPORTRADAR_API_KEY` | yes | tennis provider key; unset means "not configured", not scheduled | O | O | O |
| `SPORTRADAR_TENNIS_*` | no | tennis scope and pacing | O | O | O |
| `SYNC_EXPECTED_INTERVAL_MINUTES`, `SYNC_FRESHNESS_GRACE_MINUTES`, `SYNC_MIN_INTERVAL_MINUTES`, `SYNC_TIME_BUDGET_MINUTES`, `SYNC_STALE_LOCK_MINUTES`, `SYNC_MANUAL_COOLDOWN_MINUTES` | no | cadence tuning; defaults match `vercel.json` | O | O | O |
| `DEMO_ANCHOR` | no | demo seed anchor | O | — | — |
| `PRISMA_QUERY_LOG` | no | SQL logging | O | — | F (never in Production) |
| `MATCHBASE_NEW_PASSWORD` | yes | password input for `account:create`, `account:password` and `admin:role -- grant` (grant always sets a new password; see "ADMIN grant safety" in production-hardening.md) | shell only | shell only | shell only |
| (no variable) `account:verify` | — | operator command that marks an address confirmed (lockout fallback before opening sign-up) | shell | shell | shell, with `MATCHBASE_OPERATOR_TARGET=production` |
| `AUTH_PASSWORD_RESET_ENABLED` | no | requests self-service password recovery; honoured only with a deliverable transport (Phase 10, [account-recovery.md](../security/account-recovery.md)); when honoured, the auth server configures the reset hooks and the "Forgot password?" UI appears | O | O (absent by default) | **F for now** (absent until a verified sending domain exists) |
| `AUTH_EMAIL_VERIFICATION_ENABLED` | no | switches verification mail on (confirmation links, the Watchlist reminder offer). With a deliverable transport and sign-up open, verification becomes **required**. Sign-up can also be open **without** it (both sign-up flags above). **Not a safe switch on its own:** if unverified sign-up was ever open, setting it locks out every unverified account at the next deployment; follow the migration order in [production-hardening.md](../security/production-hardening.md#migration-risk-turning-verification-on-later) (count, confirm admins, choose a policy, rehearse on Preview) | O | O (for the Preview procedure) | **absent for now**; set only in step 8 of the account-recovery runbook, after that migration order |
| `MAIL_TRANSPORT` | no | `resend`, `dev-outbox` or `disabled`; unset means disabled | O (`dev-outbox`) | O (`resend` only with an allowlist) | O (absent for now; later `resend`) |
| `MAIL_FROM` | no | sender, `address` or `Name <address>` | O | R with `resend` (`onboarding@resend.dev` allowed for an owner-inbox test) | R with `resend`, on a verified own domain; `resend.dev` is **refused** (fails the readiness check and disables mail) |
| `MAIL_REPLY_TO` | no | single reply address | O | O | O |
| `RESEND_API_KEY` | yes | Resend sending-only key, scoped to the sending domain; must differ from `BETTER_AUTH_SECRET` and `CRON_SECRET` | — | its own key, if any | its own key (absent for now) |
| `MAIL_ALLOWED_RECIPIENTS` | no | exact addresses a non-Production Resend transport may mail | O (required with `resend`) | R with `resend` | **F** (refused; disables mail) |
| `MAIL_DAILY_CAP` | no | daily ceiling (UTC day) for reminder emails, enforced by the Phase 11 pipeline, default 100; recovery is governed by the per-IP auth limit instead | O | O | O |
| `NEON_BRANCH` | no | informational note in `.env.local` (not read by code) | O | — | — |

### Preview `DATABASE_URL_UNPOOLED`: a build-only placeholder (2026-11-10)

The Vercel **Preview** scope holds a PostgreSQL direct URL **without a user name or password**:

```
postgresql://<preview-endpoint>.<region-domain>/matchbase_preview?sslmode=require&sslaccept=strict&channel_binding=require
```

- `<preview-endpoint>` is the current Preview Neon endpoint id (on 2026-11-10: `ep-silent-butterfly-b3h7gqoq`, branch `preview-2026-11`). It must be the **direct** host, never `<endpoint>-pooler`, in the same domain as `DATABASE_URL`. The readiness guard checks this against `MATCHBASE_DATABASE_ENDPOINT` and blocks a Preview whose placeholder names another endpoint.
- The database is `matchbase_preview`, and the TLS parameters are exactly `sslmode=require`, `sslaccept=strict` and `channel_binding=require`. There are no other parameters.
- It exists only so that `env("DATABASE_URL_UNPOOLED")` in `prisma.config.ts` gets a non-empty string while `prisma generate` runs in the build. Without it, `prisma generate` stops with `PrismaConfigEnvError` and the deployment fails to build.
- It is **not** a usable connection string for migrations, seed, bootstrap, account or role commands, or anything else, and must never be used as one.
- The deployed Preview application connects only through `DATABASE_URL`, the pooled `matchbase_app` URL.
- Database work on the Preview database runs only through `~/.config/matchbase/preview.sh`, with the real connection strings in the local `~/.config/matchbase/preview.env`. Never copy the Vercel placeholder to a local file as a migration URL.

Future build changes that would make the placeholder be used for a real connection attempt, and that therefore need this setup reviewed first, are listed in [production-hardening.md](../security/production-hardening.md#preview-build-only-database_url_unpooled-2026-11-10). They do not justify putting owner credentials in the Vercel Preview scope.

Vercel system variables (`VERCEL`, `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL`) must be enabled in the project ("Enable access to System Environment Variables"); the environment model and the auth base URL derive from them.

## Launch invariants the readiness check enforces

- Production: label `production`; `DATABASE_URL` with `sslmode=verify-full`; `DATABASE_URL_UNPOOLED`, where it is checked (the operator shell; a running deployment only warns, because the running application never connects with it), with exactly `sslmode=require&sslaccept=strict&channel_binding=require`. The build is different from the runtime: Vercel's build runs `prisma generate`, which loads `prisma.config.ts` and needs a non-empty value, so the variable stays set on Vercel Production (see [production-deployment.md](production-deployment.md) step 3; the Preview placeholder policy does not apply); auth secret strong and different from the cron secret; https base URL; `CRON_SECRET` present; sign-up closed; no `MATCHBASE_DEV_*`, no `ALLOW_PRODUCTION_SEED`; CSP not off; TheSportsDB configured.
- Mail (Phase 10.5): unconfigured mail passes, because it is a safe state. In Production, any configuration the mail parser refuses fails and blocks startup: dev outbox, capture or unknown transport, `resend.dev` sender, allowlist, malformed key or sender, the recovery flag without a deliverable transport, and a Resend key equal to another secret. DNS and domain verification are reported as **not checked** (info).
- Preview: label not `production`; `MATCHBASE_DATABASE_ENDPOINT` set and every database URL on that endpoint (the build-only `DATABASE_URL_UNPOOLED` placeholder included); no Production endpoint anywhere; no dev-login flag or credentials; no seed flag; no secret reuse (checked as "auth ≠ cron" within the environment; cross-environment reuse is an operator rule that cannot be verified from one environment).
- Development: warnings only.
