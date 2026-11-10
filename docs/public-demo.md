# Public demo and authorized sign-in

Status: implemented 2026-11-06, verified locally in production mode. Not deployed.

Anyone can explore MatchBase without an account, on fictional data. Only authorized accounts can sign in, and only they read the real catalogue. Public sign-up stays closed, and this feature needs no migration and no new environment variable.

## Route model

The demo uses the existing routes. **Who is asking decides the data, not the URL.**

| Route | Anonymous | USER | ADMIN |
|---|---|---|---|
| `/` | landing page: Explore Demo, Sign in | redirect to `/dashboard` | redirect to `/dashboard` |
| `/dashboard`, `/schedule`, `/matches`, `/matches/[id]`, `/teams`, `/teams/[id]`, `/players`, `/players/[id]`, `/leagues/[id]`, `/history` | **demo data**, read-only | real data | real data |
| `/sign-in`, `/forgot-password`, `/reset-password`, `/verify-email` | available | redirect | redirect |
| `/sign-up` | says it is closed, unless an operator opens it | redirect | redirect |
| `/watchlist` | redirect to sign in | own rows | own rows |
| `/admin/**` | redirect to sign in | "Administrators only" | allowed |
| `/api/auth/**` | Better Auth's own rules | same | same |
| `/api/cron/**` | refused without the cron secret | same | same |

A separate `/demo/*` tree was rejected: it would duplicate eleven pages and thread a path prefix through more than sixty hard-coded links, for no gain in isolation.

## How the data is isolated

```
page / component ──► lib/data/queries.ts ──► catalogue() ──► resolveCatalogue(getViewer, …)
                                                  │
              a resolved session ─────────────────┼──► the Prisma repositories      PostgreSQL
              null: genuinely anonymous ──────────┼──► createDemoCatalogue(clock)   in memory
              session check failed ───────────────┴──► rejects: the error page, HTTP 500
```

- **Three states, not two.** `resolveViewer` (`lib/auth/authorization.ts`) returns a viewer or null, or throws `SessionResolutionError`. Null means no cookie, a bad signature, or an expired or revoked session. A database or auth failure is never null, so it can't reach the demo, can't redirect to sign-in, and can't read as "not signed in" in a Server Action. A visitor with no cookie never reaches the database, so the demo keeps working during an outage.
- `lib/data/demo-catalogue.ts` implements the same read interface as the repositories with the same filters and orderings. Its import graph cannot reach Prisma, the database client, the repositories or the session module, and a test walks that graph.
- The demo holds catalogue records only: no users, emails, sessions, follows, watchlists, sync logs or data sources.
- The timeline is laid over the current time on each request (`lib/demo-clock.ts`), so it never ages. Statuses are authored, so a "live" match stays live.

## The demo is fictional

The timeline's results are invented, so they must not sit beside real names in public: a score for a real club, or a final between real athletes, reads as a claim that it happened. `lib/data/demo-fixtures.ts` therefore replaces every league, team, athlete, venue and id with an invented one and reuses the timeline unchanged. Profiles and colours are invented too, so a player cannot be recognised by role, nationality and number, nor a team by its colours. Players carry no physical attributes or statistics, and teams no kits or crests: a team's only visual identity is its code badge, with a primary colour and a thin secondary ring. Badge text reaches 4.5:1, every badge stands out at 3:1 on both themes through its fill or its ring, and no ring uses the saturated red or green the app uses for state. Teams with no secondary colour render exactly as before. Tests compare every record with its source and with all real records, by colour distance for palettes. A fixture with no fictional identity throws, and a test checks that no real name or id survives in anything a visitor can read. The landing page and the banner say the data is fictional.

Sports and games (football, League of Legends, Counter-Strike 2) keep their real names: they are categories, and no result is attributed to them. The invented names were chosen to look invented but have not had a trademark search. Dates follow no real calendar: matches and seasons are both offsets from today, so a "current" season always contains its matches, and every season's length differs from every real one in `mock.ts` by more than a week, so its start and end can never coincide with one on any date. Season labels are invented too, with no year. `lib/data/mock.ts` keeps its real names and dates for development seeds; Production is never seeded. `secondaryColor` is an optional display field set only by the demo, not stored, so teams from the database render as before.

## Caching: why the same URL is safe for different viewers

Nothing in the application caches across requests, and no caching had to be disabled to get there.

| Layer | State | Why it is safe |
|---|---|---|
| Route rendering | every route is dynamic (`ƒ` in the build output) | the app and auth layouts and the landing page all read the session through `headers()`, and the proxy adds a per-request CSP nonce |
| CDN and browser | `private, no-cache, no-store` on documents and RSC payloads | Next.js sets it on dynamic responses; an end-to-end test asserts it for anonymous and signed-in requests |
| `unstable_cache`, `"use cache"`, `revalidate`, forced `fetch` caching | not used anywhere | a test fails if one is added; review any addition against this table first |
| React `cache()` | `getViewer`, `catalogue`, `getCurrentUserFollows` | scoped to one server render by React, so nothing outlives the request |
| Better Auth cookie cache | off | every request checks the Session table, so revocation applies at once |
| Module state | the auth instance, Prisma client, formatters, the fictional fixtures | none holds per-user data; demo reads copy before sorting, and a test checks shared arrays are not reordered |
| Client router cache | `staleTimes.dynamic` default, 0 | sign-in and sign-out call `router.refresh()`, which clears it, so Back after sign-out refetches |
| Shared layouts | not re-rendered on client navigation | **this one needed a fix**, below |

**The shell after a session changes elsewhere.** A client navigation re-renders the page, not the shared layout. So a tab whose session ended in another tab kept its signed-in shell, with no demo banner, around the demo catalogue the server correctly sent. `components/auth/session-sync.tsx` refreshes the tree: at once when another tab signs in or out, and on regaining focus (at most once a minute) for a session that ended some other way. It uses no timer, so nothing polls. A hidden tab makes no request: told of a change, it waits and refreshes when shown. A tab ignores its own announcement. Between a revocation and the next focus, an open tab can still show a stale shell; the data and every write are still decided by the server.

## How read-only is enforced

Hidden buttons are not the control. In order of authority:

1. **Server Actions.** Every user-state action calls `requireUser()`, and every admin action `requireAdmin()`, before reading its arguments. An anonymous call is refused whatever the client sends. A test checks the guard comes first in every action.
2. **No write path in the demo.** The demo catalogue has only `find*` methods.
3. **Client stores.** They are `readOnly` for a null viewer, so a click on Follow, Star or a reminder goes to sign-in instead of calling the action.

Demo visitors never get a session, a user id or a role: "demo" is the absence of a session. There are no demo credentials and no demo account.

## Every server-side entry point

| Entry point | Who may call it | Enforced by |
|---|---|---|
| `setTeamFollowed`, `setPlayerFollowed`, `setLeagueFollowed`, `setMatchWatchlisted`, `setWatchlistReminder` | signed in; own rows only | `requireUser()` first; the user id comes from the session |
| `setReminderEmailsEnabled` | signed in; own row only | `requireUser()` first |
| `saveAdminRecord`, `deleteAdminRecord`, `runDataSourceSync` | ADMIN | `requireAdmin()` first, through `denyUnlessAdmin` |
| `getAdminData` (the admin snapshot) | ADMIN | `requireAdmin()` in the loader |
| `devQuickSignIn` | **nobody outside local development** | `resolveDevLogin` refuses unless the runtime environment is development and the flag is set |
| `GET /api/cron/sync`, `GET /api/cron/notifications` | holder of `CRON_SECRET` | constant-time bearer check, 503 when unset; sync also refuses Preview |
| `/api/auth/sign-in/email`, password recovery, `verify-email` | public by design | Better Auth; rate limited outside development |
| `/api/auth/sign-up/email` | closed unless an operator opens it (outside development: verification mail, or both `AUTH_ALLOW_SIGN_UP` and `AUTH_ALLOW_UNVERIFIED_SIGN_UP`) | `disableSignUp` from `accountPolicy` |
| `/api/auth/get-session` | public; answers `null` without a session | Better Auth |
| Other `/api/auth/*` (update-user, change-password, list-sessions, revoke-*, delete-user and so on) | signed in; own account only | Better Auth session middleware; `role` is `input: false` |
| `GET /api/auth/reset-password/:token`, `GET /api/auth/verify-email` | nobody | answered 404 at the route (tokens must not sit in URLs) |

**Layouts are not a boundary.** A client-navigation request can name the layouts it already holds, and the server then skips them, so an anonymous request can reach an `/admin/*` page without the admin layout's guard running. This is safe because those pages hold no data: each renders a client view fed by the layout's provider, and the data loads only through `getAdminData`. Any new admin page must keep to this, or guard itself as `/watchlist` does. Tests cover the source rule and the live request, and call each admin action directly by id as an anonymous visitor and as a USER. On 2026-11-06 the layout's guard was also removed temporarily to check this: anonymous and USER requests got no admin data and every admin action still refused them.

## Navigation

| Surface | Demo visitor | Signed in |
|---|---|---|
| Banner above the header | "You're exploring the demo", with Sign in | none |
| Header | `Demo` badge | reminder bell |
| Sidebar | subtitle "Public demo", no Watchlist, no Admin, footer "Sign in" | unchanged |
| Phone tab bar | Dashboard, Schedule, Matches, More | unchanged |

Signing out now returns to the landing page rather than the dashboard. The auth pages carry an "Explore demo" link. From a demo record page, sign-in returns to the list instead of the record, because demo ids do not exist in the real catalogue.

## Things to know

- **Anonymous checks no longer exercise the database.** A database outage or a pending migration is invisible to a signed-out visitor. Any health or smoke check of the real catalogue must sign in ([smoke test](deployment/production-smoke-test.md)).
- **An expired or revoked session is an anonymous visitor**, so it gets the demo, with the banner showing. A session that cannot be *checked* gets an error page instead.
- **A shared link to a real match does not open for an anonymous visitor.** It shows the 404 page, because the id is not in the demo.

## Tests

```
npx tsx --test tests/domain/demo-catalogue.test.ts tests/auth/public-demo.test.ts tests/auth/session-resolution.test.ts
```

The end-to-end suites need a built app and a running local server, and skip without one. They refuse any host other than localhost and any environment labelled production. `VERCEL_ENV=development` marks the run as local, because the startup guard otherwise treats `next start` as Production and refuses local configuration.

```
npm run build
VERCEL_ENV=development AUTH_ALLOW_SIGN_UP=false npx next start -p 3100
MATCHBASE_E2E_BASE_URL=http://localhost:3100 npm run test:e2e
```

With sign-up open (the public sign-up journeys in `tests/e2e/public-sign-up.test.ts` and the browser suite; they create `e2e-…-<stamp>@example.test` accounts on the development database and delete exactly those):

```
VERCEL_ENV=development AUTH_ALLOW_SIGN_UP=true npx next start -p 3100
MATCHBASE_E2E_SIGN_UP=open MATCHBASE_E2E_BASE_URL=http://localhost:3100 npm run test:e2e
```

- `tests/e2e/public-demo.test.ts` works over HTTP: routes, cross-session isolation under interleaved requests, cache headers, refused actions and endpoints.
- `tests/e2e/browser-smoke.test.ts` drives headless Chrome over the DevTools protocol with no added dependency (set `MATCHBASE_E2E_CHROME` if it is elsewhere). It signs in with the `MATCHBASE_DEV_*` accounts from `.env.local`, so provision those once with the quick sign-in under `next dev`. It fails on any console error, exception, CSP violation or failed response. A failure a step causes on purpose, such as the 401 for a wrong password, is declared with `expectFailure` and must happen exactly once.

To prove the demo needs no database and that a failed session check is not anonymous, start the server with an unreachable `DATABASE_URL` and run the HTTP suite with `MATCHBASE_E2E_DATABASE=unreachable`:

```
VERCEL_ENV=development AUTH_ALLOW_SIGN_UP=false DATABASE_URL=postgresql://nobody:nobody@127.0.0.1:1/x DATABASE_URL_UNPOOLED=postgresql://nobody:nobody@127.0.0.1:1/x npx next start -p 3100
MATCHBASE_E2E_DATABASE=unreachable MATCHBASE_E2E_BASE_URL=http://localhost:3100 npx tsx --test tests/e2e/public-demo.test.ts
```

Those runs exercise the development CSP, which adds `'unsafe-eval'`; Production's policy is stricter.
