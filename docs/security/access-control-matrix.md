# Access-control matrix (Phase 9.0)

Derived from the repository on 2026-09-17. "Current" is who can perform the operation today; "Required" is the intended production actor. A row is a mismatch when the two differ. Actors: PUBLIC (anyone), USER (authenticated), ADMIN, SYSTEM (Vercel Cron with `CRON_SECRET`), OPERATOR (shell access with database URLs).

## Reads

| Operation | Code path | Current | Required | Mismatch |
|---|---|---|---|---|
| Dashboard | `app/(app)/dashboard` | PUBLIC (shows the demo user's state) | PUBLIC for catalogue sections; USER for personal sections | yes (personal sections shown to everyone) |
| Schedule, Matches, Match detail, Teams, Team detail, Players, Player detail, League detail, History | `app/(app)/**` | PUBLIC | PUBLIC | no |
| Watchlist page | `app/(app)/watchlist` | PUBLIC (demo user's) | USER | yes |
| Header reminder bell, "Following" panels | app layout seeds | PUBLIC (demo user's) | USER (empty or sign-in prompt for guests) | yes |
| Admin landing and catalogue tables | `app/(app)/admin/**` | PUBLIC | ADMIN | yes |
| Admin Data Sources, Sync Logs, Monitoring | `app/(app)/admin/**` | PUBLIC | ADMIN | yes |
| Admin snapshot (`getAdminData`) | `app/(app)/admin/layout.tsx` | PUBLIC | ADMIN | yes |

## User mutations

| Operation | Code path | Current | Required | Mismatch |
|---|---|---|---|---|
| Follow / unfollow team | `setTeamFollowed` | PUBLIC, shared demo user | USER, own rows | yes |
| Follow / unfollow player | `setPlayerFollowed` | PUBLIC, shared | USER, own rows | yes |
| Follow / unfollow league | `setLeagueFollowed` (no UI yet) | PUBLIC, shared | USER, own rows | yes |
| Add / remove watchlist match | `setMatchWatchlisted` | PUBLIC, shared | USER, own rows | yes |
| Set reminder | `setWatchlistReminder` | PUBLIC, shared | USER, own rows | yes |

## Admin mutations

| Operation | Code path | Current | Required | Mismatch |
|---|---|---|---|---|
| Create / update sport status | `saveAdminRecord("sports")` | PUBLIC | ADMIN | yes |
| Create / update league, season, team, player, venue, match, data source | `saveAdminRecord(...)` | PUBLIC | ADMIN | yes |
| Delete league, season, team, player, venue, match | `deleteAdminRecord(...)` | PUBLIC | ADMIN | yes |
| Sync now (manual provider sync) | `runDataSourceSync` | PUBLIC | ADMIN | yes |

## System and operator

| Operation | Code path | Current | Required | Mismatch |
|---|---|---|---|---|
| Scheduled sync | `GET /api/cron/sync` | SYSTEM (bearer secret) | SYSTEM | no |
| Manual sync CLI | `scripts/sync-data-source.mts` | OPERATOR | OPERATOR | no |
| Migrations, seed | `prisma migrate deploy`, `prisma db seed` | OPERATOR | OPERATOR | no |

## Summary

- 8 read rows: 5 mismatches, all "admin or personal data shown to everyone".
- 5 user mutation rows: 5 mismatches, all "shared identity, no authentication".
- 10 admin mutation rows: 10 mismatches, all "no authorization".
- 3 system/operator rows: 0 mismatches.

Every mismatch is resolved by the same two guards placed in the data-access layer and called from actions and loaders: `requireUser()` (identity from a trusted session) and `requireAdmin()` (a server-side role or allow-list). No change to repository signatures or the domain model is required.

## Status after Phase 9.1 (2026-09-17)

Every "yes" above is resolved; the "Current" column now equals "Required":

- Personal reads (dashboard sections, watchlist page, bell, "Following") resolve the session through `getViewer()`; guests get empty state and sign-in prompts, never the demo user's rows.
- Admin pages, the admin snapshot (`getAdminData`) and the three admin actions call `requireAdmin()` on the server; anonymous callers are sent to sign in, USER callers see "Administrators only" and actions answer "Only administrators can make changes."
- The five user-state actions call `requireUser()` before validating anything and write only the session's user id.
- Cron, the CLI and migrations are unchanged; the cron route additionally refuses Preview deployments unless opted in.

Verified by `tests/auth/*`, `tests/db/auth-accounts.test.ts`, `tests/db/user-isolation.test.ts`, the cron handler tests and a browser run that calls every action directly as anonymous, USER and ADMIN. Details: [authentication-and-authorization.md](authentication-and-authorization.md).
