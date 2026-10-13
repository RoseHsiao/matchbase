# MatchBase documentation

Start with the [project README](../README.md) for the overview, then the [case study](case-study.md) for the narrative. The rest are decision records written during each phase; they are kept as they were written, with a status block at the top that says what has changed since.

## Read in this order

| Document | Type | Status | Read it for |
|---|---|---|---|
| [case-study.md](case-study.md) | narrative | current (2026-09-17) | product requirement → domain problem → decision → implementation → user result, end to end |
| [screenshots.md](screenshots.md) | guide | current | which views to capture for a portfolio and what each one demonstrates |
| [demo-data-and-time.md](demo-data-and-time.md) | decision record | implemented (Phase 8.2) | why the fixed seed aged out, the demo clock, anchor resolution, time zone, consistency rules, what is and is not shifted |
| [providers/thesportsdb.md](providers/thesportsdb.md) | provider spec + verification record | implemented (Phase 8.1), **live-verified** | free-tier probe results, endpoints used and rejected, mapping, statuses, UTC timestamps, request budget, data ownership, what is live-verified versus fixture-only |
| [scheduled-sync.md](scheduled-sync.md) | architecture + verification record | implemented (Phase 8.3), smoke-tested locally | verified Vercel constraints, cron route and secret, provider-neutral scheduler, eligibility, cadence, the database run lock and stale recovery, freshness model, Admin, deployment variables |
| [operational-monitoring.md](operational-monitoring.md) | architecture + verification record | implemented (Phase 8.4) | the health model and its exact precedence, run categories, PARTIAL and abandoned-run semantics, failure streaks, bounded queries, Admin Monitoring and Sync Logs, the redaction boundary |
| [security/authentication-and-authorization.md](security/authentication-and-authorization.md) | architecture + verification record | implemented (Phase 9.1) | Better Auth with email and password, the schema extension, the session and cookie facts, `requireUser` / `requireAdmin` and where they run, anonymous behaviour, the operator-only ADMIN grant, Preview isolation, tests and limitations |
| [security/production-hardening.md](security/production-hardening.md) | architecture + verification record | implemented (Phase 9.2), verified locally in production mode | closed sign-up launch policy, operator password reset, database-backed auth rate limiting, security headers, the enforced nonce CSP, image URL validation, least-privilege database role, environment model and Preview isolation, startup configuration guard, migration and seed safety, operator command guards, logging policy, dependency findings, remaining risks |
| [security/account-recovery.md](security/account-recovery.md) | architecture + decision record | 10.1 implemented (mail foundation); recovery **disabled** in Production | Resend choice, the provider-neutral `Mailer`, environment safety rules, the sending-domain prerequisite, what 10.2–10.5 add, why reset does not verify email and delivery persistence waits for Phase 11 |
| [deployment/production-deployment.md](deployment/production-deployment.md) | operator runbook | written for Phase 9.3; **not performed** | the exact sequence from creating the Neon Production database to rollback; companions: [smoke-test checklist](deployment/production-smoke-test.md), [environment matrix](deployment/environment-matrix.md), [9.3A preflight record](deployment/phase-9-3a-preflight.md), [9.3B execution plan](deployment/phase-9-3b-plan.md) |
| [security/production-security-audit.md](security/production-security-audit.md) | audit (internal) | Phase 9.0; P0 resolved in 9.1, P1/P2 addressed in 9.2 | trust boundaries, entry-point inventory, findings by priority, threat model; companion [access-control matrix](security/access-control-matrix.md) |
| [data-model-decisions.md](data-model-decisions.md) | decision record | implemented; body maintained through Phase 7 | every schema decision with its rationale; "Prisma Schema Implementation Notes" at the end records what each phase built |
| [match-participant-model-analysis.md](match-participant-model-analysis.md) | analysis + implementation note | implemented 2026-09-15; §26 is authoritative | why `homeTeamId / awayTeamId` was replaced by `MatchParticipant`, the alternatives, the migration strategy, and the deviations |
| [external-data-sync-architecture.md](external-data-sync-architecture.md) | architecture | implemented (Phase 4), updated in place | the provider contract, sync lifecycle, external identity, idempotency, transaction boundaries |
| [live-data-integration.md](live-data-integration.md) | architecture + verification record | implemented (Phase 7) | retry policy, pagination, secret handling, mock vs live, the manual smoke test, and exactly what is and is not verified without a Sportradar key |
| [tennis-provider.md](tennis-provider.md) | provider spec | implemented; live feed unverified | Sportradar Tennis endpoints, normalization mapping, singles/doubles handling, status mapping |
| [watchlist-reminders.md](watchlist-reminders.md) | feature record | implemented (Phase 6A) | reminder model, rules, surfaces, and the future delivery architecture that is deliberately not built |
| [data-model-architecture-audit.md](data-model-architecture-audit.md) | historical audit | **superseded** (2026-09-12 snapshot of the mock-data codebase) | the reasoning that produced the schema, including the home/away recommendation that was later reversed |

## Phase history

| Phase | Date | Commit(s) | Outcome |
|---|---|---|---|
| App shell → History | up to 2026-09-12 | `feat: add application shell` … `feat: restructure admin information architecture` | every user-facing route and the Admin workspace on mock data |
| 1–3 | 2026-09-13 to 09-15 | `feat: add PostgreSQL database with Prisma`, `persist user state`, `persist admin data` | Prisma 7 + Neon; layered reads; follows and watchlist persisted; Admin CRUD persisted |
| 4 | 2026-09-15 | `feat: add provider-agnostic external data sync architecture` | sync pipeline, mock provider, Sync now, sync logs |
| Tennis | 2026-09-15 | `feat: add Sportradar tennis provider with singles and doubles normalization` | first real adapter |
| 5 | 2026-09-15 | `feat: migrate matches to participant-based model` | `MatchParticipant`; legacy columns dropped with a verifying migration |
| 6A | 2026-09-15 | `feat: add watchlist reminders and sport icons` | reminder preference persisted and shown |
| 7 | 2026-09-16 | `feat: add live data integration foundation` | retries, pagination, configuration validation, redaction, DB pipeline tests, manual sync script |
| Polish | 2026-09-16 | `feat: unify sport and esports visual system`, `feat: polish watchlist and reminder journey` | shared visual language across disciplines |
| 8.1 | 2026-09-17 | (uncommitted) | portfolio docs, Teams/Players hierarchy IA, UI polish, console cleanup |
| 8.2 | 2026-09-17 | (uncommitted) | demo timeline laid over the current date through an injectable demo clock |
| 8.1 (providers) | 2026-09-17 | (uncommitted) | TheSportsDB V1 adapter for Premier League football, verified against the live free API, through the unchanged pipeline |
| 8.3 | 2026-09-17 | (uncommitted) | scheduled sync: Vercel Cron → authenticated route → provider-neutral scheduler → the same `runSync`; database run lock; freshness in Admin |
| 8.4 | 2026-09-17 | (uncommitted) | operational monitoring: per-source health derived from persisted evidence, Admin Monitoring, Sync Logs kinds and details, redaction at the persistence boundary |
| 9.0 | 2026-09-17 | (uncommitted) | production security audit: trust boundaries, entry points, access-control matrix, prioritised findings, provider evaluation; no code change |
| 9.1 | 2026-09-17 | (uncommitted) | authentication and authorization: Better Auth (email and password), `User` extended with role and the session/account tables, `requireUser` / `requireAdmin` in the data-access layer, anonymous read-only experience, operator CLI for ADMIN, Preview guard on provider syncs; 2026-09-18: optional development quick sign-in |
| 9.3A | 2026-09-22 | (uncommitted) | production preflight: Neon and Vercel state inspected, topology decided (separate Production project), `bootstrap:system` and `account:create` operator commands, environment matrix, 9.3B plan; no infrastructure created, nothing deployed |
| 9.2 | 2026-09-18 | `699ee4a` | production hardening: closed sign-up, operator password reset, database-backed auth rate limiting, headers and nonce CSP, image URL validation, environment model with database labels, startup configuration guard, guarded migrations and seed, runtime-role template, readiness check, deployment runbook and smoke-test plan; no deployment |
| 9.3A | 2026-09-22 | `82b83c4` | production infrastructure: Neon topology (separate Production project, Preview branch), Vercel project linked to GitHub, environment matrix, `bootstrap:system` and `account:create` operator commands, readiness preflight |
| 9.3B | 2026-09-24 to 2026-10-13 | `82b83c4` | first Production deployment: migrations applied, least-privilege runtime role, system bootstrap, first ADMIN, 19 days of successful scheduled syncs ([record](deployment/phase-9-3b-plan.md#result)) |
| 9.4 | 2026-10-13 | (uncommitted) | presentation time zone: one zone literal in `lib/time-zone.ts`, pinned on every formatter and day boundary, fixing the Production hydration mismatch (React #418) |
| 10.1 | 2026-10-13 | (uncommitted) | mail foundation: provider-neutral `Mailer`, Resend over `fetch`, development outbox, disabled and capture transports, environment parser with Preview allowlist, recovery-token redaction; nothing sends at runtime, Production recovery disabled |

## Conventions in these documents

- A **Status** block at the top of each decision record says whether it is current, implemented, or superseded, and points to what replaced it. The body below the block is left as written so the reasoning is preserved.
- "Implemented" means it is in the code, has a migration where a schema change was involved, and has tests where the document names them.
- "Verified" is used only for behaviour exercised by tests or by the seeded database. The Sportradar adapter is *implemented* and *fixture-tested*; the live feed is *not verified*.
