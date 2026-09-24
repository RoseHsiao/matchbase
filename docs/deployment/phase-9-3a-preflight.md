# Phase 9.3A preflight: infrastructure state and decisions

Written 2026-09-22. This records what was inspected, what was decided and what the operator still has to do before the first Production migration (Phase 9.3B). No Production resource was created, migrated or mutated; no deployment happened.

## What was inspected

| Item | Method | Finding |
|---|---|---|
| Neon account | Neon connector, read-only listing | one project, **MatchBase** (`late-darkness-73919929`), region `aws-ap-southeast-1`, PostgreSQL 18, created 2026-09-13 from the console, compute 0.25 to 2 CU, history retention 6 h, no protected branches, no IP allow list |
| Neon branches | read-only listing | exactly one branch, named **`production`**, default, unprotected, `init_source: parent-data` |
| What that branch holds | `.env.local` host names and the 9.2 database checks | it is the **development** database: the demo catalogue, the demo user, the two dev quick-login accounts, mock-feed sync logs, the RateLimit table. `.env.local` also notes `NEON_BRANCH=production`. |
| Vercel link | `.vercel/` directory, `vercel` CLI | **not linked**; the CLI is not installed; `.vercel` is git-ignored |
| Git remote | `git remote -v` | `github.com/RoseHsiao/matchbase` |
| `vercel.json` | JSON parse | valid; one cron, `/api/cron/sync` at `0 3 * * *` (daily, Hobby-compatible) |
| Vercel environment variables | cannot be inspected without a linked project and login | unknown; assumed absent |
| Production URL or custom domain | nothing in the repository | unknown; a dependency for `BETTER_AUTH_URL` only if the primary domain differs from what Vercel reports |
| Git state | `git status`, `git log` | Phase 9.2 committed as `699ee4a feat: harden production security and deployment`; the 9.3A additions below are uncommitted |

## Decision: Neon topology

The only existing branch is the development database but carries the name `production`, and Neon branches inherit their parent's roles, passwords and (by default) data. A Production branch created inside this project would either copy development data (the demo user, dev accounts, sessions, fixtures) or, as a schema-only branch, carry pre-created tables with an empty `_prisma_migrations` ledger, which breaks `prisma migrate deploy`. Both contradict the requirement that Production starts empty and is migrated by the repository's own command.

Selected topology, the simplest one that is materially safer:

```
Neon project "MatchBase" (existing, ap-southeast-1)
├── branch "production"  → rename to "development"   (the existing development database; nothing else changes)
└── branch "preview"     → new child of development, current data, for Vercel Preview

Neon project "matchbase-production" (new, same region)
└── default branch       → the Production database: empty, protected, its own roles and passwords
```

Why a separate project for Production: a new project is empty by construction, has its own compute quota and connection limits, its own owner role and passwords, cannot be confused with a development branch in the console, and can be protected on its own. A Preview branch inside the development project is acceptable because Preview data is disposable, and Vercel's Standard Protection keeps preview URLs private; the dev quick-login accounts copied into it should be removed (step in the checkpoint below).

Region: keep `ap-southeast-1` for both projects, and set the Vercel functions region to the same area (`sin1`) when the project is created, so the interactive transactions Better Auth uses stay short. This is a Vercel project setting, not a code change.

## Decisions carried into 9.3B

- **Production starts empty.** Nothing is copied from development. `npm run bootstrap:system` (new in 9.3A) creates the six sports and the two live DataSource rows; the first TheSportsDB sync creates leagues, seasons, clubs, venues and matches. The demo seed is never run against Production.
- **First account.** `npm run account:create` (new in 9.3A) creates a normal Better Auth email/password account as USER from the operator shell while public sign-up stays closed; `npm run admin:role -- grant` promotes it. The runbook's earlier "temporary sign-up window" is withdrawn.
- **Credentials.** `DATABASE_URL_UNPOOLED` = the Production project's owner role on the direct host (operator shell only). `DATABASE_URL` = the runtime role from `prisma/sql/runtime-role.sql` on the pooled host, set on Vercel Production.
- **`MATCHBASE_OPERATOR_TARGET`** is a shell-only confirmation; it is never set on Vercel.
- **Auth origin.** Production: `BETTER_AUTH_URL` unset, derived from `VERCEL_PROJECT_PRODUCTION_URL`, unless a custom domain is the primary origin, in which case `https://<domain>`. Preview: unset; derived from `VERCEL_URL` per deployment, and the production origin is additionally trusted (no wildcards).
- **Secrets.** Three independent random values: Production `BETTER_AUTH_SECRET`, Preview `BETTER_AUTH_SECRET`, Production `CRON_SECRET`; none on Preview for cron; none reused from `.env.local`.
- **CSP.** Unchanged: the policy has no origin-specific entries other than the TheSportsDB badge hosts, so a custom domain needs no CSP change. `CSP_MODE=report-only` is a rollback, not a setting.

## Operator checkpoints (in order)

Each checkpoint is written in the CHECKPOINT format in the Phase 9.3A report. Summary:

1. Rename the existing Neon branch `production` → `development` and update the `NEON_BRANCH` note in `.env.local` (non-secret).
2. Create the Neon project `matchbase-production` (same region), protect its default branch, keep the default database and owner role, note the pooled and direct hosts. Do not copy anything.
3. Create the Preview branch `preview` from `development` (current data), then delete the copied sessions, rate-limit rows and the two `@matchbase.local` accounts in that branch.
4. Install the Vercel CLI, `vercel login`, create or link the Vercel project (`vercel link`), enable system environment variables, set Deployment Protection to Standard, set the functions region.
5. Set the Production variables (matrix in [environment-matrix.md](environment-matrix.md)) with `vercel env add <NAME> production` reading each value from a file or the prompt, never from the shell history; set the Preview variables the same way with `preview`.
6. Return here for the read-only checks: `npm run production:check -- --env production` and `-- --db` from a shell holding the Production variables, `npx prisma migrate status` for the migration state, and the same for Preview.

The runtime role SQL (`prisma/sql/runtime-role.sql`) runs only after the migrations in 9.3B, because the grants refer to tables that do not exist yet; the readiness check is therefore expected to report the owner role until then, and that is the documented reason the least-privilege verification completes in 9.3B step 5.

## Checkpoint 3 findings (2026-09-23)

- Vercel scopes verified by name: Production has `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `MATCHBASE_DATABASE_LABEL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CRON_SECRET`; Preview has `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `MATCHBASE_DATABASE_LABEL`, `BETTER_AUTH_SECRET`; Development has none. All were created as sensitive.
- Sensitive variables cannot leave Vercel: `vercel env pull` yields `[SENSITIVE]` placeholders and `vercel env run` refuses them and falls back to local `.env` files. Operator shells therefore use hand-written, git-ignored files with values from Neon; the Vercel-held secrets are verified by the startup guard at deploy time. The runbook and the 9.3B plan were corrected accordingly.
- The Preview branch's `neondb_owner` password was reset by the operator, so Preview no longer shares the development database password.
- Production project `matchbase-production`: branch `production`, database `neondb`, role `neondb_owner`, zero tables (never migrated). Preview branch `preview` in project `MatchBase` has its own compute (`ep-noisy-leaf-…`).
- Code: the Preview auth origin list now includes both generated hosts explicitly; the readiness check reports an unparsable auth URL as a failure instead of crashing.
