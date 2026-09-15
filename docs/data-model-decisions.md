# MatchBase Data Model Decisions

## Status

- Decision status: Approved for v1
- Prisma implementation: Not started
- PostgreSQL migration: Not started
- Purpose: Define the v1 data-model decisions before implementation

This document turns the findings in `docs/data-model-architecture-audit.md` into explicit decisions. The audit describes the current code; this document is the contract for what gets built. Where the two differ, this document wins for implementation, and the audit remains the record of why.

---

## 1. Database Strategy

- PostgreSQL is the primary persistent database.
- Prisma is the ORM and data access layer.
- A repository/query layer sits between application code and Prisma. Application code (pages, components, actions) never imports the Prisma client directly.
- The existing `lib/data/queries.ts` function signatures are the starting contract for the repository layer. Call sites should not change in the first migration step.
- Existing mock data is migrated gradually, one owner of data at a time, rather than through a full rewrite.
- Existing IDs and slugs are preserved where practical so routes such as `/teams/arsenal` and `/matches/m-epl-ars-che` keep working.
- Server Components may read through the repository directly. A REST API is not required merely to serve Server Components.
- API routes or server actions are introduced only where client-side mutations (follow toggles, watchlist, Admin CRUD) or external consumers need them.

---

## 2. Category and Sport/Game

- Category remains an enum/union with exactly two values: `sports` and `esports`.
- No Category database table in v1. Category is a column on Sport/Game.
- Sport/Game becomes a database entity because:
  - Admin manages its status.
  - League references it.
  - DataSource may reference it.
  - It carries real behaviour (`homeAway`), which today lives in the `sportMeta` registry.
- Existing sport/game codes (`football`, `basketball`, `lol`, `valorant`, `cs2`) are kept as the primary key values so current `League.sport` values, filters, and the client-side registry keep working.
- The code-level registry in `lib/sports.ts` may remain as a client-side mirror of the table during v1. The database is the source of truth; the registry must be seeded from the same values.

Sport/Game contains:

| Field | Notes |
|---|---|
| `id` / `code` | Text primary key, existing codes |
| `category` | Enum `sports` \| `esports`, NOT NULL |
| `name` | Display label |
| `homeAway` | Boolean; drives Home/Away versus first/second-side wording |
| `status` | Enum `active` \| `inactive`, NOT NULL, default `active` |
| `sortOrder` | Integer for display order |

Individual leagues such as NBA or LCK are never hardcoded into the schema. They are League rows.

---

## 3. League and Season

- League belongs to exactly one Sport/Game (`sportId`, required).
- Season is a separate entity belonging to League (`leagueId`, required).
- The duplicated `League.season` string label is removed from the database model. It does not exist as a column.
- Match must reference a Season (`seasonId`, required).
- A League can have multiple Seasons.
- "Current season" is represented by Season data (`status = current`), never by a string on League. At most one Season per League may be `current` at a time.

Season contains:

| Field | Notes |
|---|---|
| `id` | Text primary key |
| `leagueId` | FK → League, required |
| `name` | e.g. `2026/27`, `Summer 2026` |
| `startsAt` | Date |
| `endsAt` | Date |
| `status` | Enum `current` \| `upcoming` \| `completed`, NOT NULL |

Unique: `(leagueId, name)`. No further season abstractions (splits, stages as entities, season-team rosters) in v1.

League contains `id`, `sportId`, `name`, `shortName`, `region`, `status`. Unique: `(sportId, shortName)`.

---

## 4. Team

- In v1, Team belongs to one primary League (`leagueId`, required).
- No `LeagueTeam` many-to-many in v1.
- The option to add `LeagueTeam` later is preserved: Match carries its own `leagueId`, so cross-competition matches are representable at the database level even before a join table exists.

Team contains:

| Field | Notes |
|---|---|
| `id` | Text primary key, existing slugs preserved |
| `leagueId` | FK → League, required |
| `name` | |
| `shortName` | |
| `code` | Two or three letter abbreviation |
| `color` | Brand colour for the logo placeholder |
| `logoUrl` | Nullable |
| `status` | Enum, NOT NULL, default `active` |

Unique: `(leagueId, code)`.

---

## 5. Player

- Player belongs to zero or one Team in v1. `teamId` is nullable.
- No team membership history in v1. The option to add `TeamMembership` later is preserved.

Player contains:

| Field | Notes |
|---|---|
| `id` | Text primary key |
| `teamId` | FK → Team, nullable |
| `name` | Full name |
| `handle` | Nullable; in-game name for esports |
| `role` | Free text (position or role) |
| `nationality` | Nullable |
| `number` | Integer, nullable; squad number for traditional sports |
| `status` | Enum, NOT NULL, default `active` |

---

## 6. Match

- Keep the current two-sided match model for v1: `homeTeamId` and `awayTeamId`.
- No generic `MatchParticipant` model.
- For sports where `Sport.homeAway` is true, the two slots mean Home and Away.
- For esports where `Sport.homeAway` is false, the two slots mean the first and second competing sides. The column names stay `homeTeamId` / `awayTeamId` to match existing code; the semantics are positional.
- UI labels ("Home / Away" versus "Team A / Team B", "at" versus "vs") are driven by `Sport.homeAway`, never hardcoded per league.

Match contains:

| Field | Notes |
|---|---|
| `id` | Text primary key, existing ids preserved |
| `leagueId` | FK → League, required |
| `seasonId` | FK → Season, required |
| `homeTeamId` | FK → Team, required |
| `awayTeamId` | FK → Team, required |
| `venueId` | FK → Venue, nullable |
| `startsAt` | Timezone-aware timestamp |
| `status` | Enum `upcoming` \| `live` \| `finished`, NOT NULL |
| `stage` | Free text, nullable |
| `homeScore` | Integer, nullable |
| `awayScore` | Integer, nullable |
| `liveDetail` | Free text, nullable (e.g. `67'`, `Map 3`) |

Rules:

- `homeTeamId` and `awayTeamId` cannot be equal (database CHECK).
- `homeScore` and `awayScore` are either both null or both set (database CHECK).
- Match status is stored data. It is not inferred solely from the current timestamp.
- Match status transitions (`upcoming → live → finished`) will eventually be owned by the sync/data ingestion process. Until that exists, status is set by seed data and Admin edits.
- Indexes on `startsAt`, `(leagueId, startsAt)`, `homeTeamId`, `awayTeamId`.

### Tennis decision

For v1:

- No special player-versus-player schema for Tennis.
- No `MatchParticipant` introduced just for Tennis.
- The two-sided Match structure is kept.
- This is a known v1 limitation: Match references Teams, and a Tennis participant is a Player.
- Revisit only when real Tennis data requirements demand player-level match participants.

---

## 7. Venue

- Match references Venue through a nullable `venueId` foreign key.
- No venue name string matching in the database. The free-text `Match.venue` field does not exist in the database model; the seed resolves existing venue strings to `venueId`.
- Esports matches may have no venue, so `venueId` must remain nullable and optional in Admin forms.

Venue contains:

| Field | Notes |
|---|---|
| `id` | Text primary key |
| `name` | |
| `city` | |
| `country` | |
| `capacity` | Integer, nullable |
| `status` | Enum, NOT NULL, default `active` |

---

## 8. User and User State

A minimal User entity is introduced in v1.

User contains:

| Field | Notes |
|---|---|
| `id` | Text primary key |
| `email` | Unique |
| `name` | |
| `createdAt` | Timezone-aware timestamp |

Join tables introduced in v1:

- `UserTeamFollow`
- `UserPlayerFollow`
- `UserLeagueFollow`
- `UserWatchlistMatch`

No full authentication system is built yet. For development, a seeded development user is acceptable and stands in for the "current user" that today is the `currentUserFollows` mock singleton. Authentication is integrated later without changing these tables.

The goal is to move user state out of temporary client-side stores and mock arrays into persistent database relationships, which also removes the current inconsistency where dashboard server queries and client follow stores can disagree.

---

## 9. Follow and Watchlist

User follows and watchlist entries are relational data, not fields on Team, Player, League, or Match.

| Relationship | Table | Primary key |
|---|---|---|
| User → Team | `UserTeamFollow` | `(userId, teamId)` |
| User → Player | `UserPlayerFollow` | `(userId, playerId)` |
| User → League | `UserLeagueFollow` | `(userId, leagueId)` |
| User → Match | `UserWatchlistMatch` | `(userId, matchId)` |

Each row carries `createdAt`. Follow state is never duplicated inside domain entities (no `isFollowed` or follower counts on Team, Player, League, or Match in v1).

`UserLeagueFollow` is created even though no league follow button exists yet, because the dashboard queries already depend on followed leagues.

---

## 10. External Data Sources

DataSource becomes a database entity.

DataSource contains:

| Field | Notes |
|---|---|
| `id` | Text primary key |
| `name` | |
| `sportId` | FK → Sport, nullable (cross-discipline sources such as manual import) |
| `status` | Enum `connected` \| `disconnected` \| `attention`, NOT NULL |
| `lastSyncedAt` | Timezone-aware timestamp, nullable |

Domain entities that may originate from external providers (League, Team, Player, Match, Venue) should eventually support:

- `dataSourceId` (FK → DataSource, nullable)
- `externalId` (text, nullable)

For v1 these are direct fields on the domain entities with a unique constraint on `(dataSourceId, externalId)` per table. No polymorphic `ExternalIdentity` table. A separate identity table is considered only when one entity must be reconciled across two providers at once.

---

## 11. Sync Logs

SyncLog belongs to DataSource.

SyncLog contains:

| Field | Notes |
|---|---|
| `id` | Text primary key |
| `dataSourceId` | FK → DataSource, required |
| `entity` | Enum `matches` \| `teams` \| `players` \| `leagues` |
| `records` | Integer |
| `status` | Enum `success` \| `failed` \| `partial` |
| `durationMs` | Integer |
| `at` | Timezone-aware timestamp of the run (today's field name; may be named `startedAt` in the schema) |
| `error` | Text, nullable; new field for real failures |

The sync process owns match status updates. SyncLog is operational data and is not mixed into the core Match/League/Team domain model: no domain table references SyncLog.

---

## 12. Time and Timezone

- Timestamps are stored in PostgreSQL as timezone-aware timestamps (`timestamptz`).
- UTC is the database storage convention.
- Timestamps are converted to the user's or application's timezone at the presentation layer.
- The Taiwan UI displays Asia/Taipei time.
- Date-based queries such as "Today", "Tomorrow", and the schedule day strip must explicitly account for timezone boundaries. They take a timezone parameter rather than relying on the server's local timezone, which is what `startOfDay`, `dayKey`, and `isSameDay` in `lib/format.ts` do today.
- Season `startsAt` / `endsAt` are calendar dates, not timestamps.
- Display-formatted date strings are never stored as the source of truth.

---

## 13. IDs

- Existing meaningful IDs and slugs (`arsenal`, `epl`, `m-epl-ars-che`, `s-epl-2627`, `v-emirates`, `ds-nba`) are preserved in the seed where practical.
- New records receive generated IDs from the database layer (for example `cuid()` on a text primary key).
- Database IDs are stable and do not depend on UI-generated client state. The browser-side `newId()` helper is not a source of persistent ids.
- Existing routes are not rewritten because the database is being introduced. A separate `slug` column may be added later if ids ever become opaque.

---

## 14. Status

Database-managed entities have explicit status fields where the audit identified them as managed domain data: Sport, League, Team, Player, Venue (`active` \| `inactive`); Season (`current` \| `upcoming` \| `completed`); Match (`upcoming` \| `live` \| `finished`); DataSource (`connected` \| `disconnected` \| `attention`); SyncLog (`success` \| `failed` \| `partial`).

Status columns are NOT NULL with an appropriate default rather than relying on the application-level fallback:

```ts
status ?? "active"
```

User-facing behaviour for inactive entities (whether they are hidden from user pages) is handled separately and is not part of this document's implementation.

---

## 15. Delete Semantics

Conservative v1 policy:

- Prefer preventing destructive deletion when dependent records exist (restrict).
- Do not cascade-delete important domain data such as Matches, Teams, Players, or Seasons merely because an Admin deletes a parent League, Team, or Season.
- Prefer status inactivation over deletion where appropriate.
- Optional references (`Player.teamId`, `Match.venueId`) may be set to null when the referenced row is removed.
- User join tables (follows, watchlist) may cascade on deletion of either side, because they carry no domain data.
- Exact Prisma referential actions are decided during schema implementation based on these principles.

---

## 16. Deferred / Future Models

Explicitly deferred until a concrete product requirement exists:

- `LeagueTeam` (team in multiple competitions)
- `TeamMembership` / player team history
- `MatchParticipant`
- `MatchPeriod` / set / map breakdown
- Category database table
- `ExternalIdentity` (polymorphic provider identity)
- `AuditLog` (replacement for the mock AdminActivity)
- Advanced analytics-specific tables

None of these are implemented in v1.

---

## 17. v1 Domain Relationship

```
Category (enum)
    ↓
Sport/Game
    ↓
League
    ↓
Season
    ↓
Match
 ↙      ↘
Team    Team
 ↓
Player

Match → Venue (optional)

DataSource → SyncLog
DataSource → Sport/Game (optional)

User
 ├── UserTeamFollow      → Team
 ├── UserPlayerFollow    → Player
 ├── UserLeagueFollow    → League
 └── UserWatchlistMatch  → Match
```

Team also references League directly (primary league). Match references League, Season, both Teams, and optionally Venue.

---

## 18. Implementation Order

**Phase 1**
- Prisma + PostgreSQL setup
- `schema.prisma` for the v1 tables in this document
- Initial migration
- Seed the existing mock data (ids preserved, each match assigned its league's current season, venue text resolved to `venueId`, one development user with the current follows and watchlist)

**Phase 2**
- Repository/query layer implementing the existing `queries.ts` signatures
- Migrate catalogue reads (Sport, League, Season, Team, Player, Venue, Match)
- First database-backed page: `/matches`
- Validate that every other user-facing page still renders identically before moving on

**Phase 3**
- Migrate User + follows + watchlist
- Server actions or route handlers behind the id-set stores
- Dashboard follow queries read from the database

**Phase 4**
- Migrate Admin CRUD to the persistent database
- Sport status persists
- Delete behaviour follows section 15

**Phase 5**
- DataSource + SyncLog + external ID fields
- External API fetcher
- Normalization into the repository
- Sync pipeline, including match status transitions

**Phase 6**
- Introduce deferred models only when actual product requirements justify them

---

## 19. Non-Goals for v1

- No full authentication system
- No public API requirement
- No generic participant abstraction
- No multi-league team relationship
- No player team history
- No polymorphic external identity system
- No Category CRUD table
- No analytics warehouse or analytics data model
- No real-time sync implementation yet

---

## 20. Decision Summary

| Area | v1 Decision |
|------|-------------|
| Category | Enum |
| Sport/Game | Database entity |
| League | Database entity |
| Season | Separate database entity |
| Team | One primary League |
| Player | Optional Team |
| Match | Two-sided Home/Away-style model |
| Tennis | Keep two-sided model for now |
| Venue | Nullable FK |
| User | Minimal entity |
| Follow/Watchlist | Join tables |
| DataSource | Database entity |
| SyncLog | Database entity |
| External IDs | Direct fields initially |
| Time | UTC in DB |
| API | Optional for Server Components |
| Repository | Required |
| Deferred abstraction | Only when justified |

---

## Final note

This document is the v1 data-model decision contract for MatchBase.

It is intentionally conservative: the schema should model the current product domain without prematurely introducing generalized abstractions for requirements that do not yet exist.

Prisma/PostgreSQL implementation should follow these decisions unless a new concrete product requirement or technical constraint requires revisiting them.

---

## Prisma Schema Implementation Notes

The initial schema lives at `prisma/schema.prisma`. It implements sections 1 to 20 above. This section records every place where the schema had to interpret, narrow, or defer a decision. No architectural decision above was changed.

### Interpretations made

| Topic | Schema choice | Reason |
|---|---|---|
| Enum casing | `SPORTS`, `ACTIVE`, `CURRENT`, `LIVE`, … | Prisma convention. Mock data uses lowercase (`"sports"`, `"active"`, `"live"`); the seed and repository map between the two |
| DataSource status | `ACTIVE` \| `INACTIVE` (the schema brief), not `connected` \| `disconnected` \| `attention` (section 10) | Mapping for the seed: `connected → ACTIVE`, `disconnected → INACTIVE`, `attention → ACTIVE`. "Needs attention" becomes a derived health signal from the latest `SyncLog` rather than stored status. Section 10 stays as written; this narrows it |
| Sync status | `RUNNING` \| `SUCCESS` \| `PARTIAL` \| `FAILED` | The brief's minimum plus `PARTIAL`. `RUNNING` is new and supports in-progress runs. See "SyncStatus.PARTIAL" below |
| SyncLog timestamp | `startedAt` | The mock field `at` maps to `startedAt`. Chosen because a `RUNNING` row has a start but no end. Section 11 allowed either name |
| SyncLog `entity` | Free-text `String` | The brief excludes an enum here. Values today are `matches`, `teams`, `players`, `leagues` |
| Sport ids | Explicit `String @id`, no generated default | The id is the stable code the app already uses (`football`, `basketball`, `lol`, `valorant`, `cs2`). Codes are chosen by the seed, never by the schema. Adding `tennis` is a row. Whether to rename `lol` / `cs2` to longer codes is a seed decision, not a schema one |
| Season dates | `DateTime @db.Date` | Time of day is not meaningful for a season window; the app already stores `YYYY-MM-DD` |
| Absolute instants | `DateTime @db.Timestamptz(3)` | `Match.startsAt`, `User.createdAt`, join-table `createdAt`, `DataSource.lastSyncedAt`, `SyncLog.startedAt`. Prisma's plain `DateTime` would map to `timestamp` without zone |
| `Match.status` default | `UPCOMING` | Matches the admin form default. Transitions belong to the sync process |
| `Season.status` default | `UPCOMING` | Matches the admin form default |

### SyncStatus.PARTIAL

`SyncStatus` includes `PARTIAL` in addition to the required `RUNNING`, `SUCCESS`, and `FAILED`. `PARTIAL` represents a synchronization run that completed but in which some records succeeded and some failed, for example a feed that returned seven matches and rejected two. It is distinct from `FAILED`, where the run produced no usable records, and from `SUCCESS`, where every record was applied. The value already exists in the mock sync logs and in section 11, so keeping it means no seed row loses information and the Admin sync-log status filter keeps its three outcome states. A `PARTIAL` run should carry an `error` describing what was skipped.

### Nullability differences from mock data

The schema brief asked for wider nullability than the current TypeScript types. These fields are optional in the database even though every mock row fills them:

| Field | Mock type | Schema | Note |
|---|---|---|---|
| `League.region` | required | nullable | |
| `Team.color` | required | nullable | The logo placeholder reads `color`; the repository should supply a fallback colour when null |
| `Player.role` | required | nullable | |
| `Venue.city`, `Venue.country` | required | nullable | |

`Player.teamId` is nullable by decision (section 5). `Match.venueId`, `Match.stage`, `Match.liveDetail`, scores, `Player.handle`, `Player.nationality`, `Player.number`, `Team.logoUrl`, `Venue.capacity`, `DataSource.sportId`, `DataSource.lastSyncedAt`, `SyncLog.durationMs`, `SyncLog.error`, `User.name` are nullable as specified.

### Constraints that cannot be expressed in Prisma schema

These are documented invariants for the repository layer. No workaround was built into the schema. Repository/application validation is acceptable for v1.

- `Match.homeTeamId <> Match.awayTeamId`. Can later become a PostgreSQL CHECK constraint in a hand-written migration.
- `Match.homeScore` and `Match.awayScore` are both null or both set. Can later become a PostgreSQL CHECK constraint in a hand-written migration.
- At most one `Season` per `League` with status `CURRENT`. This cannot be represented by a normal Prisma constraint, and it is not a CHECK constraint either, because it spans rows. The eventual database-level solution is a PostgreSQL partial unique index on `leagueId WHERE status = 'CURRENT'`, added in a hand-written migration. Until then the repository enforces it when a season is created or its status changes.

### External identity: implemented

`dataSourceId` (nullable FK → `DataSource`, `onDelete: SetNull`) and `externalId` (nullable) were added directly to `League`, `Team`, `Player`, `Venue`, and `Match`, each with `@@unique([dataSourceId, externalId])`. PostgreSQL treats nulls as distinct in unique indexes, so existing local rows with both fields null do not collide. No `ExternalIdentity` table exists. `DataSource` carries the corresponding back-relations.

### Referential actions

| Relation | `onDelete` | Principle |
|---|---|---|
| League → Sport | Restrict | Domain parent |
| Season → League, Team → League, Match → League | Restrict | Deleting a league cannot remove seasons, teams, or matches |
| Match → Season | Restrict | Results are history |
| Match → Team (both slots) | Restrict | Deleting a team cannot remove its matches |
| Player → Team | SetNull | Optional reference; the player becomes a free agent |
| Match → Venue | SetNull | Optional reference |
| Domain entity → DataSource (external id) | SetNull | Provenance is disposable |
| DataSource → Sport | SetNull | Optional scope |
| SyncLog → DataSource | Cascade | Operational data with no meaning without its source |
| User join tables → User and → target | Cascade | Rows carry no domain data |

Because every domain parent is Restrict, Admin "delete" on a league, team, or season with dependants will fail at the database. The intended path is inactivation via `status` (section 15).

### Indexes

Indexes follow the query patterns in the audit's section 8.1. Where a composite unique constraint already leads with the foreign key (`League(sportId, shortName)`, `Team(leagueId, code)`, `Season(leagueId, name)`), no separate single-column index was added. `Match` carries indexes on `startsAt`, `(status, startsAt)`, `(leagueId, startsAt)`, `seasonId`, `(homeTeamId, startsAt)`, `(awayTeamId, startsAt)`, and `venueId`. `Season` has `(leagueId, status)` for the current-season lookup. Join tables index the target id so "who follows this team" queries do not scan. `SyncLog` indexes `(dataSourceId, startedAt)` and `startedAt`.

### Relations to review

- `Match.homeTeam` / `Match.awayTeam` use named relations `"HomeTeam"` and `"AwayTeam"` with back-relations `Team.homeMatches` / `Team.awayMatches`. Review that the repository's "matches involving team X" query unions both.
- `DataSource` now has five domain back-relations plus `syncLogs`. This is the cost of direct external id fields and is expected.

### Prisma configuration and validation status

Prisma **7.10.0** was chosen over 6.x (decision recorded 2026-09-13). Prisma 7 rejects the Prisma 6 header (`url` in the datasource block is no longer supported), so the following configuration changes were made. They are the only permitted changes to the schema file; every model, enum, field, relation, index, constraint, and `onDelete` is unchanged.

| Item | Value |
|---|---|
| Packages | `prisma@7.10.0` (dev), `@prisma/client@7.10.0`, `@prisma/adapter-pg@7.10.0` (brings `pg` as its dependency) |
| Generator | `provider = "prisma-client"`, `output = "../lib/generated/prisma"` |
| Datasource block | `provider = "postgresql"` only; no `url` |
| CLI config | `prisma.config.ts` at the project root, loaded automatically by the CLI |
| CLI connection | `DATABASE_URL_UNPOOLED` (direct Neon connection). Migrate must not use the pooled connection because PgBouncer transaction mode breaks it |
| Runtime connection | `DATABASE_URL` (pooled), passed to `PrismaClient` through `PrismaPg` from `@prisma/adapter-pg`. Not wired into application code yet |
| Env loading | Prisma 7 does not read `.env` files. `prisma.config.ts` loads `.env.local` then `.env` with Node's built-in `process.loadEnvFile`, so no `dotenv` dependency was added. Next.js loads the same files for the application |
| Generated client | Written to `lib/generated/prisma`, git-ignored (`/lib/generated/`), excluded from ESLint (`lib/generated/**`). Run `npx prisma generate` after a fresh install; a `postinstall` script can be added when the repository layer lands |
| Validation | `prisma format` and `prisma validate` pass. `prisma migrate status` connects to the Neon database and reports it is not yet managed by Migrate (no migrations exist yet) |

Runtime wiring for the next phase (not implemented here): construct one `PrismaPg` adapter from `DATABASE_URL` and pass it as `{ adapter }` to `new PrismaClient(...)` imported from `@/lib/generated/prisma/client`; hold a single instance across hot reloads in development.

- No `updatedAt` fields were added. `createdAt` exists only where creation time is meaningful (`User`, the four join tables). `SyncLog.startedAt` serves that role for runs.
- No `@@map` table-name overrides were used; table names equal model names.

### Seed (prisma/seed.ts)

`npx prisma db seed` runs `tsx prisma/seed.ts` (configured under `migrations.seed` in `prisma.config.ts`; `tsx` is a dev dependency). The seed imports the mock arrays from `lib/data/mock.ts` and the sport registry from `lib/sports.ts`, keeps every existing id, and upserts by id, so it is idempotent and never truncates. It does not seed `User` or the four follow/watchlist tables, and there is no table for `AdminActivity`.

Normalisation performed by the seed:

| Mock | Database |
|---|---|
| `sports` + `sportMeta` (code registry) | `Sport` rows; `sortOrder` is registry order |
| `League.season` label | `Match.seasonId` = the league's `Season` with that name (each league has exactly one, and it is the `CURRENT` one) |
| `Match.venue` free text | `Match.venueId` by exact `Venue.name`; two mock matches have no venue and keep null |
| `Match.score.{home,away}` | `homeScore` / `awayScore` |
| lowercase statuses | Prisma enums; DataSource `connected` and `attention` → `ACTIVE`, `disconnected` → `INACTIVE` |
| `SyncLog.at` | `SyncLog.startedAt`; `error` is null because the mock has none |

Determinism: `mock.ts` computes every timestamp relative to the moment it is imported (`fromNow(minutes)` and `at(dayOffset, hour, minute)` in machine-local time). The seed anchors all of them to a fixed reference instant instead: **2026-09-14 12:00 Asia/Taipei** (`2026-09-14T04:00:00Z`). `fromNow` offsets are recovered from the import-time clock and rounded to the minute; `at` values are transcribed as generator specs in the seed and evaluated in Asia/Taipei. On every run the seed re-evaluates each spec against the live mock value and throws if they disagree, so the transcription cannot drift from `mock.ts`. Running the seed twice produced byte-identical timestamps. The consequence is that the seeded "today" is fixed; once the application reads from the database, dashboard sections keyed on the real current date will show these matches as past until real data or a sync process replaces them.

### Read path (Phase 1, implemented 2026-09-14)

User-facing catalogue reads now come from PostgreSQL:

```
Server Component / page
  ↓ lib/data/queries.ts          (unchanged function names and signatures)
  ↓ lib/data/repositories/*      (Prisma queries, include shapes, Prisma → domain mapping)
  ↓ lib/data/db.ts               (server-only PrismaClient singleton, PrismaPg adapter, pooled DATABASE_URL)
  ↓ Neon PostgreSQL
```

- `lib/data/types.ts` remains the application model. `repositories/mappers.ts` maps every Prisma record to it; no component or page sees a Prisma type. Optional domain fields are `undefined`, never `null`.
- The domain `League.season` label is derived per query from the league's seasons (current first, then upcoming, then most recent completed) through a nested `take: 1` include. No season string exists in the database.
- `Match.venue` (domain, free text) is the related `Venue.name`; `Match.score` is built from `homeScore` / `awayScore` when both are set.
- Still mock-backed on purpose: `currentUserFollows` (seeds the client stores and drives the dashboard's followed filters) and `getAdminData` (Admin persistence is its own phase). These are the only remaining runtime imports of `lib/data/mock.ts`.
- Players without a team are excluded from user-facing reads because the domain `Player.teamId` is required. None exist in the seed.
- A sport id present in the database but missing from `lib/sports.ts` throws with a clear message; the registry must be updated alongside a new `Sport` row.
- Ordering differences from the mock: leagues are listed by sport registry order then name (the mock used array order, which put LEC before LCK); a team's roster is sorted by display name (the mock used array order). Match lists use `startsAt` with `id` as a tiebreak. Team and player lists sort in memory with `localeCompare`, as before.
- Time zone: day boundaries for "today", the schedule window, and history still come from the helpers in `lib/format.ts`, which use the server's local time, exactly as the mock implementation did. The Asia/Taipei presentation rule in section 12 is not yet implemented anywhere in the app and is a separate follow-up; nothing in this phase changed that behaviour.
- The seeded dataset is a static snapshot anchored to 2026-09-14 12:00 Asia/Taipei. Date-relative sections (today, upcoming, history) will drift as calendar time moves on until real data or a sync process replaces it.
- Relation loads are batched by Prisma (`IN (...)` per relation), so statement counts scale with the number of query calls per page, not with rows. The dashboard issues several dozen statements because its sections call `getMatches` and `getTeamViews` independently; request-scoped memoisation with React `cache()` is a possible follow-up, not done here.
- `PRISMA_QUERY_LOG=1` prints every SQL statement from the application client.

### User state (Phase 2, implemented 2026-09-14)

Follows and the watchlist are persisted in PostgreSQL. The four normalized join tables from the schema are the source of truth; `currentUserFollows` in `lib/data/mock.ts` is no longer read at runtime and survives only as seed input.

```
Client Component (follow / watchlist button)
  ↓ useIdSet() from components/id-set-provider.tsx   (client cache, optimistic update, rollback on failure)
  ↓ Server Action in lib/data/user-state-actions.ts  (passed to the provider as a prop from the app layout)
  ↓ lib/data/repositories/user-state-repository.ts   (idempotent upsert / deleteMany, FK errors surfaced)
  ↓ lib/data/db.ts → Prisma → Neon PostgreSQL

Server Component (dashboard, layout seeds)
  ↓ lib/data/queries.ts  (getFollowedTeamIds, getFollowedPlayerIds, getFollowedLeagueIds, getWatchlistIds,
                          and the follow filters inside getTodaysMatches, getUpcomingFollowedMatches, getQuickStats)
  ↓ one request-scoped React cache() read of all four id sets
  ↓ user-state-repository → Prisma
```

- **Demo user.** There is no authentication. `lib/data/current-user.ts` (server-only) exposes `getCurrentUserId()`, which returns the constant `demo-user` from `lib/data/demo-user.ts`. It is the only place that knows who the user is; a later auth phase replaces its body with a session lookup and nothing else changes. The seed creates that user (`guest@matchbase.app`, "Guest", matching the sidebar placeholder) and turns the mock `currentUserFollows` ids into its join rows, so the dashboard and watchlist demo state is unchanged. The seed only guarantees those rows exist; it never removes rows the user added.
- **Mutations.** Four Server Actions, one per relationship, each taking `(id, desired state)`: `setTeamFollowed`, `setPlayerFollowed`, `setLeagueFollowed`, `setMatchWatchlisted`. Follow/add is an `upsert` on the composite primary key (no read-then-write race); unfollow/remove is a `deleteMany`. Unknown ids are rejected by the foreign keys and reported as a plain error. After a write the action calls `refresh()` from `next/cache` so server-rendered sections that depend on follows (dashboard matches, stats, the layout's store seeds) re-render from the database.
- **Client state.** The three id-set providers were kept as a lightweight cache of server state rather than replaced. The app layout seeds them from the database on every render and passes the matching action as `persist`. A toggle updates the store immediately, calls the action, and rolls the store back if the action rejects. When the server sends a fresh id list the store re-syncs to it, so it can never diverge from PostgreSQL for longer than one in-flight action. No new state library, no API route.
- **Caching.** User-specific reads use React `cache()`, which is scoped to one request, so no user's follows can leak into another's render once real users exist. Nothing user-specific is stored in a cross-request cache.
- **League follows** have a repository, an action, and a query, but no UI toggle yet (unchanged from before; the dashboard filters on them).
- **Seed robustness.** Every seed transaction now carries a 60-second timeout; the default 5 seconds was exceeded by a 26-row batch over the remote connection.
- No schema change and no migration were needed: the join tables already existed.

### Admin persistence (Phase 3, implemented 2026-09-15)

Admin CRUD now writes to PostgreSQL. Admin and the user-facing pages operate on the same rows: renaming a team in Admin renames it on the team page, changing a match's stage or venue changes the match page, and follow and watchlist rows stay attached because ids never change.

```
Admin view (client)
  ↓ useAdminCollection().upsert / remove          (components/admin/admin-data-provider.tsx)
  ↓ optimistic change to the CollectionStore cache, then
  ↓ saveAdminRecord / deleteAdminRecord           (lib/data/admin-actions.ts, Server Actions)
  ↓ adminRepository.save* / delete*               (lib/data/repositories/admin-repository.ts)
  ↓ lib/data/db.ts → Prisma → Neon PostgreSQL
  ↓ refresh() → admin layout re-reads getAdminData() → stores reset to the database snapshot

Admin layout (server)
  ↓ getAdminData() → adminRepository.getAll()     (one batched query per collection)
```

- **`lib/collection-store.ts`** stays as the client cache behind the admin tables, dialogs, and filters. It is no longer a source of truth: the layout re-seeds every store from the database on each render, and a rejected write rolls the store back and shows an inline alert. It gained a `reset` method for that.
- **Validation and errors.** Every write validates the untrusted form payload on the server (required text, enum values, integers, dates, ids), then upserts by id. Prisma unique (P2002), foreign-key (P2003), and missing-row (P2025) errors become plain `AdminError` messages; nothing else reaches the UI. Match writes also enforce the rules the schema cannot: distinct teams, paired scores, and teams and season belonging to the match's league. Season writes enforce one CURRENT season per league at the repository level (the partial unique index remains deferred).
- **Delete semantics** follow the schema: League and Season deletes are blocked by the database while dependants exist and surface as clean errors; Team deletes are refused while the team has players or matches (the schema would set players' team to null, but the domain Player requires a team); Player and Match deletes cascade their follow and watchlist rows; Venue deletes set matches' venue to null. Delete-dialog wording was updated to match.
- **Sports & Games.** `Sport.status` is persisted; the catalogue itself, labels, category, and Home/Away wording still come from `lib/sports.ts` (decisions §2). Admin edits status only, as before.
- **Form changes forced by the schema.** The League form no longer has a "Current season" text field: the label is derived from Season rows and managed on the Seasons page. The Match form gained a Season select (required, defaulting to the league's current season) and replaced the free-text venue with a Venue select. The domain `Match` type gained optional `seasonId` and `venueId` so the admin UI can carry them.
- **Data sources.** Stored status is `ACTIVE | INACTIVE`; the "Needs attention" state shown in Admin is derived from the latest sync log (FAILED or PARTIAL), so it reproduces the previous mock display. Sync logs are read-only in Admin, read from the database; the domain `SyncStatus` gained `running`.
- **Still deferred:** AdminActivity remains the mock demo feed on the Admin landing page (no audit table); authentication; external API fetching and sync jobs. No schema change, migration, or new dependency was needed. Existing ids are preserved on update; new records keep the client-generated `newId()` convention so the optimistic row and the database row share an id.
- **Timezone:** unchanged. The Match form converts its local `datetime-local` value with `new Date(value).toISOString()` exactly as before.

### Deferred (unchanged from section 16)

`LeagueTeam`, `TeamMembership`, `MatchParticipant`, `MatchPeriod`, a Category table, `ExternalIdentity`, `AuditLog`, and analytics models are not in the schema.
