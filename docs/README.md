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

## Conventions in these documents

- A **Status** block at the top of each decision record says whether it is current, implemented, or superseded, and points to what replaced it. The body below the block is left as written so the reasoning is preserved.
- "Implemented" means it is in the code, has a migration where a schema change was involved, and has tests where the document names them.
- "Verified" is used only for behaviour exercised by tests or by the seeded database. The Sportradar adapter is *implemented* and *fixture-tested*; the live feed is *not verified*.
