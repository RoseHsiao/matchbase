# Production security and access audit (Phase 9.0)

Status: audit only, 2026-09-17. No application behaviour, schema, dependency or configuration was changed. This document records what must be secured before MatchBase is exposed publicly on Vercel, and defines the scope of Phase 9.1. Companion: [access-control-matrix.md](access-control-matrix.md).

> **Update 2026-09-18 (Phase 9.2).** The P1 items are addressed: database-backed rate limiting on the auth endpoints, a security-header baseline and an enforced nonce CSP, and a least-privilege runtime-role template with a readiness check that verifies it (creating the Neon role is a runbook step). Of the P2 items, `logoUrl` validation and the unbounded public reads are fixed; the Prisma CLI advisories are documented as unreachable at runtime. P3: error logging goes through one redacting helper and route error pages exist. Details and remaining risks: [production-hardening.md](production-hardening.md).
>
> **Update 2026-09-17 (Phase 9.1).** The four P0 findings below are resolved: Better Auth (email and password) provides sessions; `requireUser()` guards every personal mutation and `requireAdmin()` guards the admin loader and actions; visitors are anonymous until they sign up, the demo user is fixture data nobody can sign in as; Preview deployments refuse provider syncs unless opted in. Implementation and verification: [authentication-and-authorization.md](authentication-and-authorization.md). The body below is the audit as written; P1 to P3 remain open.

## 1. Executive summary

MatchBase is **not ready for public deployment as it stands**, for one structural reason with several consequences: the application has no authentication, and every server mutation runs as a single shared demo user. Concretely:

- Every Admin mutation (catalogue create, edit, delete; "Sync now" against a real provider) is a Server Action reachable by any internet user with a direct POST; the `/admin` pages themselves render for anyone and expose operational internals.
- Every "personal" mutation (follow, watchlist, reminder) writes to the one demo user, so any anonymous visitor changes what every other visitor sees.
- Environment isolation between Preview and Production is a deployment convention, not something the code enforces.

What is already sound: no client-supplied user identity is trusted anywhere; the cron boundary is authenticated with a constant-time bearer comparison and refuses to run without a secret; all inputs to Server Actions are validated server-side; the only raw SQL statement is parameterised; secrets never reach the client bundle and no credential has ever been committed; provider base URLs are server configuration only; persisted sync diagnostics are redacted; Server Actions carry Next.js's built-in POST-only and Origin checks.

The P0 list is short and entirely about authentication and authorization plus deployment isolation. Everything else is P1 to P3 hardening.

## 2. Trust-boundary map

```
Internet
  │
  ▼
Browser (anonymous today; authenticated user and admin are future states)
  │
  ├─ public reads ───────────► Server Components (app/(app)/**/page.tsx)
  │                               └─ lib/data/queries.ts → repositories (server-only) → Prisma → Neon
  │                               getCurrentUserId() = DEMO_USER_ID for every request
  │
  ├─ user mutations ─────────► Server Actions lib/data/user-state-actions.ts   ← no auth, shared demo user
  │                               └─ userStateRepository (userId injected server-side)
  │
  ├─ admin reads ────────────► app/(app)/admin/layout.tsx → getAdminData()     ← no auth: all tables + sync logs
  ├─ admin mutations ────────► Server Actions lib/data/admin-actions.ts        ← no auth
  │                               ├─ adminRepository writes (validated payloads)
  │                               └─ syncDataSource → runSync → provider HTTP   ← anyone can trigger provider traffic
  │
  └─ GET /api/cron/sync ─────► lib/api/cron-sync.ts (CRON_SECRET bearer, constant time) → scheduler → runSync
                                  system boundary: Vercel Cron on the production deployment only

Local operator ──► scripts/sync-data-source.mts, prisma migrate/seed  (DATABASE_URL_UNPOOLED, same Neon role)

Server ──► external providers: TheSportsDB (public key, fixed host), Sportradar (key header, fixed host)
           base URLs from environment only; browser and Admin never supply URLs

Vercel environment ──► DATABASE_URL, DATABASE_URL_UNPOOLED, CRON_SECRET, provider keys, SYNC_*, DEMO_ANCHOR
                       scoped per environment by Vercel; Preview isolation not enforced by code
```

The database boundary is the repositories: every module that touches Prisma is `server-only`, and no Client Component imports them (verified by import search and by scanning the built client bundle).

## 3. Server entry-point inventory

| Entry point | Kind | Method | Purpose | Input and validation | Mutates | Current auth | Current authz | Abuse protection | DB | External | Required actor |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `setTeamFollowed`, `setPlayerFollowed`, `setLeagueFollowed` | Server Action | POST | follow toggles | id string ≤200 chars, boolean coerced by use | yes | none | none (demo user) | none | yes | no | user |
| `setMatchWatchlisted` | Server Action | POST | watchlist toggle | id ≤200 | yes | none | none | none | yes | no | user |
| `setWatchlistReminder` | Server Action | POST | reminder preference | id ≤200; reminder enum validated in repository (`isWatchlistReminder`), status rules enforced | yes | none | none | none | yes | no | user |
| `saveAdminRecord(collection, item)` | Server Action | POST | create/update 8 collections | collection name whitelisted; payload validated field by field (ids `^[A-Za-z0-9_.-]{1,200}$`, enums `oneOf`, text length caps, integer ranges, ISO dates, sport ids against registry, participant rules, league/season/team consistency) | yes | none | none | none | yes | no | admin |
| `deleteAdminRecord(collection, id)` | Server Action | POST | delete 6 collections | whitelist + id ≤200; referential checks in repository; cascades delete user follows/watchlist rows | yes | none | none | none | yes | no | admin |
| `runDataSourceSync(id)` | Server Action | POST | manual sync | id ≤200; source must exist and be bound | yes (catalogue + logs) | none | none | only the per-source DB lock | yes | **yes**, 25 paced requests to TheSportsDB per run | admin |
| `GET /api/cron/sync` | Route Handler | GET | scheduled sync | no body; auth header only | yes | CRON_SECRET bearer, constant time, 503 when unset | system | recency gate, time budget, per-source lock | yes | yes | system |
| `/admin/**` pages | Server Components | GET | admin UI | none | no | none | none | none | full snapshot read | no | admin |
| all other pages | Server Components | GET | public UI | route params (ids) used in `findUnique` lookups; no searchParams used | no | none | public | none | reads | no | public |
| `scripts/sync-data-source.mts`, `prisma migrate deploy`, `prisma db seed` | CLI | – | operator tasks | argv id | yes | shell access + DATABASE_URL_UNPOOLED | operator | – | yes | sync only | local operator |

There are no other route handlers, no form actions outside these modules, no PUT/PATCH/DELETE handlers, and no `use server` files beyond the two listed.

## 4. Access-control matrix and mismatches

The full matrix is in [access-control-matrix.md](access-control-matrix.md). Every mismatch between current and required access is one of three kinds:

1. **Admin operations are public.** All eight `saveAdminRecord` collections, six `deleteAdminRecord` collections, `runDataSourceSync`, and every `/admin` page including Monitoring and Sync Logs.
2. **User operations are public and shared.** Five user-state actions write to the demo user for every caller.
3. **Everything else already matches** (public reads, system cron, operator CLI).

## 5. Admin exposure

- **Pages** at `/admin`, `/admin/{sports,leagues,seasons,teams,players,venues,matches,data-sources,sync-logs,monitoring}` render for any visitor. The admin layout ([app/(app)/admin/layout.tsx](../../app/(app)/admin/layout.tsx)) calls `getAdminData()` unconditionally and ships the whole snapshot to the client store: every catalogue row, every DataSource including provider configuration detail text (variable names, never values), every SyncLog including redacted error text, and health inputs.
- **Server Actions** `saveAdminRecord`, `deleteAdminRecord`, `runDataSourceSync` in [lib/data/admin-actions.ts](../../lib/data/admin-actions.ts) contain no authentication or authorization. Next.js documentation (verified, "Built-in Server Actions Security features") states that an exported action "is reachable via a direct POST request, not just through your application's UI" and that action IDs only "reduce the risk in cases where an authentication layer is missing"; authorization must be verified inside each action.
- **Direct invocation** therefore lets an attacker who has loaded the page once (to learn action IDs from the client bundle) create, edit and delete catalogue rows, delete matches (which cascades to every user's watchlist rows and reminders), and start real provider syncs.
- **Hiding navigation or redirecting `/admin`** would protect nothing: the actions remain callable, and the data would still be in the RSC payload of any page that loads it.
- **Required server-side boundaries for Phase 9.1:** (a) inside each admin Server Action, (b) inside `getAdminData()` or the admin layout before loading the snapshot, (c) a page-level redirect for UX only. The natural single place is a `requireAdmin()` guard in a `server-only` data-access module called by both the actions and the admin data loader, matching the Next.js Data Access Layer recommendation.

## 6. User identity and ownership

- Identity is chosen in exactly one place: [lib/data/current-user.ts](../../lib/data/current-user.ts) returns the constant `DEMO_USER_ID` ("demo-user", email `guest@matchbase.app`, created by the seed). It is `server-only` and `async` precisely so a session lookup can replace its body.
- Every user-state action and query obtains `userId` from `getCurrentUserId()`; the repository signatures take `userId` as a parameter but it is never sourced from the client. No component, action or route accepts a `userId`, email or owner id from the browser (search confirmed).
- **Locations assuming the demo user:** `current-user.ts`; `queries.ts` (`getCurrentUserFollows` and every follow/watchlist read); `user-state-actions.ts` (five actions); the app layout, which seeds client stores with the demo user's watchlist and follows for every visitor; `nav-user.tsx`, which displays the demo name and email; the seed, which creates the demo rows; the database tests, which use `DEMO_USER_ID`.
- **Consequence today:** all anonymous visitors share one account. Anyone can follow, unfollow, save, unsave and change reminders for everyone. This is not an IDOR (there is no object id to swap) but it is a public mutation of what will become personal state.
- **Signatures that will change in 9.1:** none of the repository functions need to change shape; `getCurrentUserId()` becomes session-derived and must fail (or return a guest sentinel that forbids writes) when no session exists. The five user-state actions must reject unauthenticated callers.

## 7. Object-level authorization (IDOR)

| Object | Mutation path | Ownership check today | Required |
|---|---|---|---|
| UserTeamFollow, UserPlayerFollow, UserLeagueFollow, UserWatchlistMatch (+ reminder) | user-state actions | rows are addressed by `(userId, targetId)` with `userId` from the server, so a caller cannot reach another user's rows by changing the target id; but with a shared user there is only one owner | keep server-derived `userId`; once sessions exist the existing composite keys are the ownership check |
| User | no mutation path | – | none in 9.1 beyond creation by the auth provider |
| Sport, League, Season, Team, Player, Venue, Match, DataSource | admin actions | none (no owner concept; admin-only resources) | `requireAdmin()` |
| SyncLog | read-only via admin snapshot | none | admin read only |
| Match delete | admin | none; deleting a match cascades to every user's watchlist rows | admin only; consider a soft-delete or confirmation policy later (P3) |

No mutation currently lets an authenticated user reach another user's data by editing an id, because identity is server-side and rows are keyed by it. The gap is authentication, not object authorization.

## 8. Input validation

Server-side validation exists at every mutation boundary and repositories receive typed values:

- User-state actions: ids are strings of 1 to 200 characters; reminder values are checked against the enum in the repository; status rules (not saved, live, finished) are enforced there too.
- Admin writes: an untyped payload is parsed field by field in `admin-repository.ts` (`payload`, `text` with caps, `requiredText`, `id` regex, `oneOf` enums, `optionalInt` with minimum, `isoDate`, `instant`, `sportId` against the registry); unknown properties are ignored; participants pass `validateParticipants`; cross-entity consistency is checked (teams in the match's league, season in the league, one current season per league); Prisma known errors are mapped to safe messages.
- Cron route: no input beyond the header.
- Pages: dynamic `[id]` params go straight into `findUnique`/`findMany` lookups by primary key, never into raw SQL; no `searchParams` are read anywhere; search and filters are client-side over preloaded data.

Gaps (none security-critical):

- `Team.logoUrl` (admin, up to 2000 characters) and `Team.color` (16 characters) are free text: no URL scheme or host check, no colour format check. `logoUrl` is rendered as an `<img src>`; see §16.
- Provider `logoUrl` (`strBadge`) is accepted as-is from TheSportsDB.
- Booleans in user-state actions are not checked for type (a truthy non-boolean behaves as `true`); harmless with server-derived identity.

## 9. Server Actions

| Action | Invokable by | Authz inside | Args validated | Trusts client identity | Mutates DB | External work | Error exposure |
|---|---|---|---|---|---|---|---|
| user-state (5) | anyone | no | yes | no | yes | no | throws `Error("Invalid … id.")` for bad ids: in production Next.js forwards only a generic message and digest for server-thrown errors (verified, error.js reference); `ReminderError` messages are returned as values by design |
| `saveAdminRecord` | anyone | no | yes | n/a | yes | no | returns `AdminError` messages only; other errors logged server-side, generic text returned |
| `deleteAdminRecord` | anyone | no | yes | n/a | yes | no | same |
| `runDataSourceSync` | anyone | no | yes | n/a | yes | **yes** | returns pipeline messages, which are redacted before they are produced |

Best enforcement layer: the Next.js Data Access Layer pattern the project already follows. Add `requireUser()` and `requireAdmin()` to a `server-only` auth module and call them at the top of each action **and** inside the data loaders that serve admin or personal data, so a page-level redirect is never the only barrier. Actions stay thin; authorization lives beside data access.

## 10. Route Handlers

Only `GET /api/cron/sync` exists. Classification: **system**. Verified properties: single method (no POST handler); `CRON_SECRET` compared in constant time over digests; missing or short secret yields 503 and no execution; wrong or absent header yields 401; responses carry `cache-control: no-store`; the JSON summary contains source ids, outcomes, counts and redacted reasons, never configuration values; unexpected failures return a fixed message. The handler performs mutations on GET, which is the documented Vercel Cron contract; it is not cookie-authenticated, so it is not CSRF-reachable. Request size is irrelevant (no body). The secret is sufficient for a system-only boundary provided it is at least 16 random characters and set only in Production; a Preview deployment with the same secret would let a holder of the secret run syncs against whatever database that Preview points at (see §20).

## 11. CSRF and cross-origin mutation

Verified from current Next.js documentation ("Allowed origins"): Server Actions are POST-only, and Next.js aborts a Server Action request whose `Origin` header does not match `Host` (or `X-Forwarded-Host`). Combined with browsers' default `SameSite=Lax` cookies, this prevents cross-site form and fetch invocation. All MatchBase mutations except cron are Server Actions, so **no additional CSRF token is needed today**. The cron route is bearer-authenticated, not cookie-authenticated, so it is not affected. What changes with cookie-based authentication in 9.1: Server Actions remain protected by the Origin check; any **new cookie-authenticated Route Handler** (for example an auth provider's own endpoints) must bring its own CSRF protection, which the candidate providers do; `serverActions.allowedOrigins` is only needed if a proxy or custom domain makes `Origin` and `Host` differ.

## 12. Secret management

| Item | Location | Tracked | Finding | Remediation |
|---|---|---|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | `.env`, `.env.local` | untracked (`.gitignore` ignores `.env*` except `.env.example`) | present locally only; placeholders in `.env.example` | none |
| `CRON_SECRET` | `.env.local` | untracked | development value only | set a distinct production value in Vercel |
| TheSportsDB key | none required (public `123` default) | – | – | none |
| Sportradar key | unset | – | – | none |
| Git history | all commits | – | pattern search found only placeholders: `.env.example` examples, test fixtures with invented values, a doc placeholder. **No real credential was ever committed.** No `.env` file other than `.env.example` appears in history | none; no rotation required |
| Client bundle | `.next/static` | build output | scanned for secret, provider, database and host strings after every build: clean | keep the scan in validation |
| Logs | server `console.error` | – | see §23 | – |
| SyncLog and Admin | database | – | redacted at the persistence boundary (`redactSensitiveText`), tested | – |

`.env.local` contains a database connection string and the development cron secret; it must stay untracked, which `.gitignore` guarantees.

## 13. Client and server boundary

All thirteen modules that touch Prisma, the current user, sync services or the scheduler are marked `server-only`. No `"use client"` component imports any of them; Client Components import only pure libraries (`lib/format`, `lib/schedule`, `lib/hierarchy`, `lib/data/sync/freshness`, `health`, `schedule-config`, provider registry types via the admin snapshot). `process.env` is read only in server modules (db, providers, scheduler config, redaction, cron route) plus the demo anchor in `mock.ts`, which guards for a missing `process`. No `NEXT_PUBLIC_` variable exists. The built client bundle contains none of the secret or configuration strings. The dependency direction is correct; the only note is that `lib/data/mock.ts` is imported by a server repository and by the seed, and its `process.env` read is harmless if it were ever bundled for the client because it reads only `DEMO_ANCHOR`.

## 14. Database security model

- Runtime uses the pooled `DATABASE_URL` through `@prisma/adapter-pg`, one client per process (`lib/data/db.ts`); the CLI, seed and manual sync use `DATABASE_URL_UNPOOLED`.
- **Both URLs use the same Neon role**, the database owner. Production should use a runtime role limited to DML on the application tables and keep the owner role for migrations and the operator CLI; Neon supports additional roles per branch. This is a P1 hardening item, not a code change.
- Raw SQL: exactly one statement, `SELECT "id" FROM "DataSource" WHERE "id" = ${dataSourceId} FOR UPDATE` in `sync-ops.ts`, using Prisma's tagged template, which parameterises the value. No `$executeRaw`, no `Unsafe` variants, no dynamic identifiers. `dataSourceId` reaches it only from the registry or from a validated admin action. **No SQL injection path exists.**
- Transactions: the lock acquisition runs in a short interactive transaction (15 s timeout); sync writes are per-record statements by design; tests wrap in rolled-back transactions.
- `sslmode=verify-full` on both URLs.

## 15. Outbound requests and SSRF

All outbound HTTP originates in provider adapters through `fetchJson` (`lib/data/sync/utils/http.ts`). Hostnames, protocol and paths come from environment configuration (`THESPORTSDB_BASE_URL`, `SPORTRADAR_TENNIS_BASE_URL`) with hard-coded defaults; query values are provider ids from code (`leagueId` 4328) or from the provider's own responses (team ids, season strings), URL-encoded. The Admin DataSource form carries only name, sport and status: **no browser- or admin-controlled value can influence a request URL**, so there is no SSRF path. `Team.logoUrl` is never fetched server-side; it is rendered by the browser. Remaining notes: `fetch` follows redirects by default (acceptable with fixed trusted hosts); timeouts are 10 to 15 s; response bodies are parsed as JSON with an object check and no explicit size cap (TheSportsDB listings are small; a cap is P3 hardening); malformed payloads fail the run or the record; provider messages are redacted.

## 16. XSS and rendered external content

No `dangerouslySetInnerHTML`, `innerHTML`, HTML or markdown rendering, or `javascript:` URLs exist. All provider and admin text (team names, league names, venue names, issue messages) is rendered through React's escaping. The two URL-bearing values rendered are `Team.logoUrl` (as `<img src>` inside the Avatar) and `NavUser.avatarUrl` (never set today). An `<img src>` cannot execute script, so this is not XSS; the residual risks are mixed content (`http:` badge on an `https:` page), third-party image requests revealing viewer IPs to arbitrary hosts, and `data:` payloads, all of which an admin or a compromised provider could introduce. Recommended: accept only `https:` URLs for `logoUrl` at the admin boundary and in the TheSportsDB adapter, and later constrain `img-src` in a CSP (§17).

## 17. Security headers

None are configured in `next.config.ts`. Vercel terminates TLS and redirects to HTTPS; whether HSTS is emitted on the eventual custom domain must be verified on the deployment rather than assumed. Recommended for production: `Strict-Transport-Security` (once the domain is HTTPS-only), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` or CSP `frame-ancestors 'none'` (MatchBase has no embedding use case), and a minimal `Permissions-Policy`. A `Content-Security-Policy` should wait until Phase 9.1 fixes the auth provider (its scripts, frames and callback origins) and until the external image hosts are known (`r2.thesportsdb.com` today); Next.js's nonce-based CSP guide applies. Not implemented in this phase.

## 18. Rate limiting and abuse

Upstream pacing (24 requests per minute to TheSportsDB, 28-request budget) protects the provider, not MatchBase. MatchBase has no request rate limiting anywhere.

| Operation | Appropriate control |
|---|---|
| future login and sign-up | provider-side rate limits plus edge limits |
| Admin Sync now | admin authorization first; the DB lock already prevents concurrent runs per source; a per-source minimum interval for manual runs is a cheap follow-up |
| follow, watchlist, reminder | authentication first; writes are idempotent upserts keyed by `(userId, target)`, so repetition cannot inflate data; per-user rate limit later |
| public page reads | Vercel CDN and function concurrency; queries are bounded by catalogue size |
| cron | secret plus recency gate and time budget |

## 19. Resource exhaustion

Existing bounds: cron time budget 4 min and `maxDuration` 300 s; per-source lock; provider request budget; Prisma singleton and Neon pooling; SyncLog admin read capped at 500 rows; recent runs per source capped at 10; team lookups capped by the budget.

Missing bounds: `getMatches()`, `getFinishedMatches()`, `getTeamViews()`, `getPlayerViews()` and `getAdminData()` load whole tables. At current scale (54 matches, 51 teams) this is fine; with several provider leagues over a season the Matches and History pages and the admin snapshot will grow linearly and should gain server-side windows and pagination (P2). Provider responses have no byte cap (P3). An unauthenticated `runDataSourceSync` is the one path where an anonymous caller can consume Function time and provider quota; authorization removes it.

## 20. Preview versus Production isolation

Nothing in the code distinguishes environments; isolation is entirely a matter of which values Vercel injects per environment. Risks if all environments share values: a Preview could read and write production data, run real provider syncs into production, and answer to the production `CRON_SECRET`. Vercel Cron itself invokes only the production deployment (verified), so Preview would not be scheduled, but its `/api/cron/sync` remains callable by anyone holding the secret.

Intended model:

| Environment | Database | Cron secret | Provider keys | Admin |
|---|---|---|---|---|
| Local development | developer Neon branch (`.env.local`) | local value | public key | open, local only |
| Vercel Preview | a Neon branch created per preview or a shared staging branch, never the production branch | distinct or unset (unset makes the route refuse to run) | public key | admin auth as in production; consider `VERCEL_ENV` gating to refuse Preview cron runs |
| Vercel Production | production branch, runtime role | production value | as needed | admin auth |

Recommended: set `DATABASE_URL*` per environment in Vercel, use Neon's branch-per-preview integration, and add a guard in 9.1 that refuses provider syncs when `VERCEL_ENV === "preview"` unless explicitly enabled.

## 21. Dependencies and supply chain

`npm audit` reports four high findings, all through the `prisma` CLI package (a devDependency also executed at build time): `mysql2` ≤3.23.0 (auth-plugin downgrade, unbounded zlib inflate) and `deepmerge-ts` <8 (stack exhaustion), reached via `prisma` → `@prisma/config` and `prisma` → `mysql2`. **Confirmed exposure in MatchBase: none.** The runtime never imports the `prisma` CLI or `mysql2`; the application uses PostgreSQL through `@prisma/client` and `@prisma/adapter-pg` (`pg` 8.23). The only "fix" npm offers is a downgrade to Prisma 6.19, a major version change that would break the driver-adapter setup; it is not appropriate. Action: track Prisma 7.x patch releases and re-run the audit; consider moving `prisma generate`/`migrate deploy` off the build step only if the CLI's transitive tree becomes a genuine concern. Runtime dependencies (Next 16.3.4, React 19.2.8, Prisma client 7.10, pg 8.23, Base UI 1.8) carry no reported advisories.

## 22. Error disclosure

- Server Component and Server Action errors thrown in production are replaced by a generic message and a digest (verified, error.js reference), so Prisma messages, hostnames and paths do not reach the browser through thrown errors.
- Admin actions return only `AdminError` messages authored in the repository, and a fixed sentence for anything else.
- Reminder and sync messages returned as values are authored or redacted text.
- The cron route returns a fixed message on unexpected failure.
- No `error.tsx` boundaries exist; the default Next.js error page is shown, which is acceptable but could be replaced with branded boundaries (P3).

## 23. Logging and PII

Server logs contain: `console.error("Admin mutation failed.", error)` and `console.error("Sync failed unexpectedly.", error)` with the full error object (may include Prisma error text and, for connection failures, the database host), and the cron route's failure line. Nothing logs emails, user ids, query strings, headers or provider payloads. The demo email `guest@matchbase.app` is rendered in the sidebar, not logged. Recommendation for 9.1: pass logged error messages through `redactSensitiveText` as well, never log session tokens or emails, and keep provider payloads out of logs.

## 24. Threat model

| Threat | Asset | Entry | Existing mitigation | Gap | Impact | Mitigation |
|---|---|---|---|---|---|---|
| Anonymous user edits or deletes catalogue data | catalogue, users' watchlists (cascade) | admin Server Actions | validation only | no auth | data loss, defacement | `requireAdmin()` in actions and data loader |
| Anonymous user triggers provider syncs repeatedly | Function time, provider quota | `runDataSourceSync` | per-source lock; provider pacing | no auth, no manual-run interval | quota exhaustion, cost | admin auth; minimum interval for manual runs |
| Anonymous user reads operational internals | sync logs, config detail, health | `/admin/**` RSC payload | redaction of secrets | no auth | information disclosure (no secrets) | admin auth on the loader |
| Visitor changes everyone's follows and reminders | shared demo state | user-state actions | idempotent writes | shared identity | confusing, defaces the demo | session-derived identity; guests read-only |
| Malicious authenticated user targets another user's rows (future) | personal state | user-state actions | `userId` server-derived; composite keys | none once sessions exist | none | keep identity server-side |
| Compromised or malformed provider response | catalogue, UI | adapter | JSON checks, record isolation, status never guessed, React escaping, redaction | image URL scheme unchecked; no body size cap | mixed content, oversized body | https-only `logoUrl`; body cap |
| Leaked cron URL without secret | sync | `/api/cron/sync` | 401 without secret; 503 when unset | none | none | none |
| Leaked `CRON_SECRET` | sync, Function time | route | recency gate, time budget, lock | rotate | bounded extra provider traffic | rotate in Vercel; Preview never shares it |
| Preview pointed at production database | production data | Preview deployment | none in code | environment discipline | production mutation from previews | per-environment values, Neon branches, `VERCEL_ENV` guard |
| Automated bot hammering mutations | Function time, DB | Server Actions | Origin check, idempotent writes | no rate limit | cost | auth first, then per-user limits |
| Operator mistake (seed against production, wrong URL) | production data | CLI | seed is idempotent and addresses fixed ids | none | demo rows in production | separate roles and URLs; make seeding refuse production unless flagged |

## 25. Prioritised findings

### P0 (must fix before public deployment)

1. **Admin Server Actions are unauthenticated.** Path: `lib/data/admin-actions.ts` (`saveAdminRecord`, `deleteAdminRecord`, `runDataSourceSync`) → `admin-repository.ts` writes and `syncDataSource`. Precondition: any internet user with the action IDs from the page bundle. Impact: catalogue tampering and deletion (cascading into users' watchlists), provider traffic on demand. Remediation: `requireAdmin()` inside each action and inside the admin data loader; page redirect for UX. **Fixed in 9.1**: `requireAdmin()` is the first statement of all three actions; verified by direct action calls as anonymous and USER.
2. **Admin pages and snapshot are public.** Path: `app/(app)/admin/layout.tsx` → `getAdminData()`. Impact: operational information disclosure. Remediation: same guard in the loader. **Fixed in 9.1**: `getAdminData()` calls `requireAdmin()`; the layout redirects anonymous visitors and renders a denial for USER.
3. **All visitors share one writable user.** Path: `lib/data/current-user.ts` → `user-state-actions.ts`, app layout seeding. Impact: any visitor mutates everyone's personal state. Remediation: session-derived identity, `requireUser()` in the five actions, guests read-only. **Fixed in 9.1**: `current-user.ts` is gone; `getViewer()` / `requireUser()` (lib/auth/session.ts) are the only identity source; guests read empty state and are prompted to sign in.
4. **Environment isolation is not enforced.** Path: Vercel environment values. Precondition: Preview configured with production values. Impact: production data mutated from previews. Remediation: per-environment variables, Neon branch per preview, `VERCEL_ENV` guard for provider syncs. **Code guard fixed in 9.1** (`providerSyncPolicy`: cron 403 and Admin refusal on Preview unless `ALLOW_PREVIEW_PROVIDER_SYNC=true`); the per-environment variable scopes remain a deployment task and are documented.

### P1 (before inviting real users)

5. **No rate limiting on mutations.** Path: all Server Actions. Remediation: after auth, per-user limits on user-state writes and a minimum interval for manual syncs. **9.2:** auth endpoints rate limited with shared database storage; manual sync has a 10-minute cooldown from run history; user-state writes rely on authentication plus idempotent composite keys (documented decision, no per-user limiter).
6. **Single database role for runtime and migrations.** Remediation: least-privilege runtime role in Neon; owner role for operators. **9.2:** SQL template and `production:check --db` verification; the role itself is created in the Phase 9.3 runbook.
7. **No security headers.** Remediation: HSTS (verify), nosniff, Referrer-Policy, frame-ancestors, Permissions-Policy; CSP once the auth provider and image hosts are fixed. **9.2: fixed** (baseline headers on every response; nonce-based CSP enforced).

### P2 (soon after launch)

8. `Team.logoUrl` accepts any scheme; rendered as an image. **9.2: fixed** (https-only at both write boundaries and at render; CSP `img-src` lists the badge hosts).
9. Unbounded catalogue reads on Matches, History, Teams, Players and the admin snapshot. **9.2: bounded** (watchlist reads only saved matches; list reads capped at 1000, admin matches at 5000); pagination deferred.
10. Prisma CLI transitive advisories (`mysql2`, `deepmerge-ts`): not exploitable at runtime; track patch releases. **9.2: unchanged, documented.**
11. Manual sync minimum interval and Preview cron refusal. **9.2: fixed** (cooldown; Preview refusal since 9.1).

### P3 (defence in depth)

12. Redact server `console.error` output; add `error.tsx` boundaries; cap provider response size; document match-delete cascade policy; consider `experimental.taint` for the admin snapshot. **9.2:** redacting log helper and error pages done; response-size cap, cascade policy and taint remain.

## 26. Phase 9.1 scope

Requirements, derived from the matrix:

- **User authentication** with a server-verifiable session, because personal state must belong to a person.
- **A MatchBase `User` row per authenticated identity**, mapped once at sign-in (the existing `User` model with `id` and `email` is sufficient; follows and watchlist already hang off it).
- **Trusted identity in one module**: `getCurrentUserId()` reads the session; nothing else changes signature.
- **`requireUser()` and `requireAdmin()`** in a `server-only` auth module, called inside every Server Action and inside the data loaders that serve personal or admin data.
- **ADMIN authorization** from a server-side fact (a role on the user or an allow-list of user ids in the environment), never from client state.
- **Guests**: public reads unchanged; follow, watchlist and reminder controls prompt sign-in; the demo user remains a seed fixture for screenshots and tests, not the identity of visitors.
- **Preview/Production**: per-environment variables, a `VERCEL_ENV` guard on provider syncs in Preview.
- **Cron unchanged.**

Deferred from 9.1: rate limiting, headers and CSP, Neon role split, pagination, `logoUrl` validation, logging redaction.

Outcome (2026-09-17): implemented as specified with Better Auth; see [authentication-and-authorization.md](authentication-and-authorization.md).

## 27. Authentication provider requirements and evaluation

Must support: Next.js 16 App Router with Server Components and Server Actions (session readable via a server call, not only in middleware); Vercel deployment; PostgreSQL through Prisma 7 with driver adapters, or a hosted identity with a clean mapping to the MatchBase `User` row; a role or allow-list mechanism usable in `requireAdmin()`; open-source or a free tier that permits production use; CSRF-safe endpoints; a maintained project.

Verified from current official sources (2026-09-17):

| Candidate | App Router | Prisma 7 | Admin roles | Middleware | Identity location | Cost | Notes |
|---|---|---|---|---|---|---|---|
| **Better Auth** | route handler mount at `/api/auth/[...all]`; `auth.api.getSession({ headers })` in Server Components and Actions | `@better-auth/prisma-adapter` with `provider: "postgresql"`, documented for Prisma 7 with `@prisma/adapter-pg`; CLI adds `user`, `session`, `account`, `verification` tables to the Prisma schema | admin plugin adds `role` and ban fields, `adminRoles` / `adminUserIds`, `userHasPermission` | optional (docs recommend cookie-presence checks only) | in MatchBase's own database | open source | Auth.js is now part of Better Auth (banner on authjs.dev) |
| **Auth.js (next-auth)** | `auth()` in server code | Prisma adapter | via callbacks and custom fields | optional proxy | own database | open source | installation still points at `next-auth@beta`; project ownership moved to Better Auth Inc. |
| **Clerk** | `auth()` / `currentUser()`; **`clerkMiddleware()` required** | not applicable; users live in Clerk; map to `User` via webhooks or JIT creation | organizations / `publicMetadata` | required | hosted by Clerk | free "Hobby" up to 50,000 MRU with 7-day sessions and Clerk branding; Pro from $25/month | fastest UI; identity outside the database |

Given the requirement that identity map cleanly to the existing `User` row and that admin authorization be a server-side fact in the same database, **Better Auth fits the stated architecture best**: it stores users in the Prisma schema MatchBase already owns, needs no middleware, exposes the session to Server Actions directly, and its admin plugin supplies the role field `requireAdmin()` needs. Auth.js reaches the same shape but its Next.js package is still in beta and the project has been folded into Better Auth. Clerk is a strong hosted option if a managed UI matters more than keeping identity in the database, at the cost of a required middleware layer and a mapping step. The final choice is made in Phase 9.1 with these facts; this audit does not install anything.

## 28. Validation for this phase

Audit only. `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` were run to confirm nothing changed; results are in the phase report. `npm audit` findings are in §21. No auth dependency is installed, no schema migration exists, no production data was touched, no provider was called.
