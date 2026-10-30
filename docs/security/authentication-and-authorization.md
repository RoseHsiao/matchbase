# Authentication and authorization (Phase 9.1)

Status: implemented 2026-09-17, verified locally (tests, browser flows, operator CLI). Not yet deployed. Resolves the four P0 findings of the [Phase 9.0 audit](production-security-audit.md): admin actions and the admin snapshot are now ADMIN-only, every visitor has their own identity or none, personal mutations require a session, and Preview deployments refuse provider syncs unless an operator opts in.

```
Browser ── cookie (HttpOnly, signed) ──► /api/auth/[...all]   Better Auth (sign-up, sign-in, sign-out, session)
                                              │ reads / writes User, Session, Account, Verification (Prisma)
Server Component / Server Action ──► getViewer()  ── Session table ──► Viewer { id, email, name, role } | null
                                              │
                         requireUser()  ──────┤  personal actions and reads
                         requireAdmin() ──────┘  admin loader and admin actions
Vercel Cron ─ Bearer CRON_SECRET ──► /api/cron/sync   (unchanged: no session, no user)
Operator shell ──► npm run admin:role   (the only path to the ADMIN role)
```

## What was verified before writing code

Current Better Auth documentation (installation, database concepts, session management, options, Next.js integration, Prisma adapter, email and password, cookies, security, rate limiting) and Vercel's system environment variables reference, all read on 2026-09-17, plus the installed package's own schema definition (`getAuthTables`), which is what the adapter actually enforces. Differences from what the 9.0 audit assumed:

- The Prisma adapter is a separate package (`@better-auth/prisma-adapter`, also pulled in by `better-auth`), imported from `better-auth/adapters/prisma`; the CLI generates schema but cannot migrate Prisma (Prisma Migrate does that).
- Rate limiting is on by default in production with in-memory storage, which the docs call unsuitable for serverless; database storage needs an extra `rateLimit` table. Left at the default and recorded as a limitation (generic rate limiting is out of scope for this phase).
- The sign-in error code for a closed sign-up is `EMAIL_PASSWORD_SIGN_UP_DISABLED`; duplicate emails are `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`.
- Middleware (`proxy.ts` in Next.js 16) is optional and the docs recommend at most a cookie-presence check there; every real check belongs in pages and actions. MatchBase adds no proxy.
- Vercel exposes `VERCEL_ENV` (`production` | `preview` | `development`), `VERCEL_URL` and `VERCEL_PROJECT_PRODUCTION_URL` at build and run time; these drive the base URL and the Preview guard.

## Provider and method

**Better Auth 1.7.5** with the Prisma adapter, as the audit recommended: identity lives in MatchBase's own PostgreSQL, the session is readable from Server Components and Server Actions, no middleware is required, and the role is a column MatchBase owns. No second provider was introduced.

**Email and password** is the first method. Reasons: it needs no third-party credentials or mail transport, which this deployment does not have; Better Auth hashes with scrypt and applies stricter built-in limits to the sign-in endpoint; and OAuth or magic links can be added later as configuration without touching the authorization boundary, because nothing outside `lib/auth` knows how a session was created. Email verification is off (`requireEmailVerification: false`) because there is no mail transport; turning it on is one option plus a `sendVerificationEmail` function. **Update (Phase 10.7):** verification is implemented. `requireEmailVerification` follows `accountPolicy`: it is required exactly when public sign-up is open, which in turn needs `AUTH_EMAIL_VERIFICATION_ENABLED` and a deliverable transport ([account-recovery.md](account-recovery.md)).

Password policy: 10 to 128 characters (`lib/auth/password-policy.ts`, shared by the server configuration and the sign-up form). **Since Phase 9.2 sign-up is closed by default outside local development** (launch policy in [production-hardening.md](production-hardening.md)); `AUTH_ALLOW_SIGN_UP=true` opens it, `false` closes it anywhere. Better Auth's `disableSignUp` enforces the choice server-side. Password recovery is an operator command (`npm run account:password`) until a mail transport exists.

## Modules

| Module | Boundary | Responsibility |
|---|---|---|
| `lib/auth/authorization.ts` | pure | `Viewer`, `UserRole`, `AuthorizationError`, `toViewer`, `assertUser`, `assertAdmin`. Nothing here imports Better Auth or Next.js. |
| `lib/auth/auth-env.ts` | pure | secret validation (32+ chars), base URL resolution, trusted origins, sign-up flag |
| `lib/env/runtime-environment.ts` | pure | `VERCEL_ENV` → environment; `providerSyncPolicy` (the Preview guard) |
| `lib/auth/redirect.ts` | pure | `safeNextPath`, `signInHref` (same-origin `next` only) |
| `lib/auth/create-auth.ts` | factory | the Better Auth configuration; bound to a Prisma client and an env by the caller |
| `lib/auth/auth.ts` | server-only | the application instance (pooled client, `process.env`), created lazily |
| `lib/auth/session.ts` | server-only | `getViewer()` (request-memoised), `requireUser()`, `requireAdmin()` |
| `lib/auth/client.ts` | browser | `authClient` for sign-in, sign-up, sign-out; error-code → safe message |
| `app/api/auth/[...all]/route.ts` | route handler | Better Auth endpoints, Node.js runtime |
| `components/auth/viewer-provider.tsx` | client | the server-rendered viewer for display decisions; `useSignInPrompt` |
| `scripts/admin-role.mts` | operator CLI | `list`, `grant <email>`, `revoke <email>` |

Domain code depends only on `Viewer`. Repositories still take a MatchBase `userId`; the actions obtain it from `requireUser()` and never from arguments. There is no separate auth-user table: the Better Auth user *is* the MatchBase `User` row.

## Schema

Migration `20260917104310_better_auth_sessions`, inspected before applying. Additive except one backfilled constraint:

- `User`: `name` becomes NOT NULL (backfilled to `''` first; the seeded demo user already had a name), plus `emailVerified`, `image`, `updatedAt` (Better Auth core fields) and `role UserRole NOT NULL DEFAULT 'USER'`.
- `Session` (`token` unique, `userId` cascade, index on `userId`), `Account` (credential or provider link; `password` holds the scrypt hash; index on `userId`), `Verification` (index on `identifier`). Ids are Better Auth's random ids; Prisma's `cuid()` default is a fallback.
- The `UserRole` enum keeps the database honest: no row can hold a role the application does not know.

Existing data was preserved: the demo user, 8 team follows, 10 player follows, 8 watchlist rows, 54 matches, 9 data sources and 25 sync logs counted identical before and after. No reset, no seed re-run.

## Session and cookie facts

Verified against the running instance and the tests in `tests/db/auth-accounts.test.ts`:

- Database sessions, 7-day expiry, refreshed once a day of use; no cookie cache, so a revoked session or a changed role applies on the next request (the role tests flip ADMIN → USER and read it back through `getSession` immediately).
- Cookie `better-auth.session_token` (`__Secure-` prefixed in production): HttpOnly, SameSite=Lax, Secure in production, value = token + HMAC signature. The browser never receives the session or user as JSON except through the auth endpoints it called.
- Sign-out revokes the session row for that device only.
- CSRF: Better Auth verifies the `Origin` header against the base URL and `trustedOrigins`; Next.js Server Actions are POST-only and check `Origin` against `Host`. No custom CSRF token was added because no gap exists: both mutation paths already reject cross-origin requests, and the session cookie is SameSite=Lax.
- Trusted origins: the deployment's own base URL; a Preview additionally trusts the production origin. Nothing wildcarded.

## Base URL and secrets

`BETTER_AUTH_SECRET` (32+ random characters, different per environment) is required; a short or missing value fails the first auth request with a clear `AuthConfigError`. `BETTER_AUTH_URL` is optional: on Vercel production it defaults to `https://$VERCEL_PROJECT_PRODUCTION_URL`, on Preview to `https://$VERCEL_URL`, locally it stays unset so one `.env.local` serves any port. Outside development a base URL is mandatory (`readAuthEnv` throws otherwise). Neither value is `NEXT_PUBLIC_`; the client bundle is scanned for both names.

## Authorization

Roles: `USER` (every new account) and `ADMIN`. The role is a Better Auth `additionalField` with `input: false`, so sign-up and profile-update bodies that include `role` are ignored server-side (tested: a sign-up claiming `role: "ADMIN"` is stored as USER; `updateUser` with a role leaves it unchanged). `toViewer` collapses any unknown stored value to USER.

Guards and where they run:

| Guard | Called from | Behaviour |
|---|---|---|
| `requireUser()` | the five user-state actions, first line | anonymous → `AuthorizationError("unauthenticated")`; the void actions reject, `setWatchlistReminder` returns `{ ok: false, error: "Sign in to set reminders." }` |
| `requireAdmin()` | `getAdminData()` (the loader for every `/admin/**` page) and the three admin actions, before validation, repository calls or `runSync` | anonymous → unauthenticated, USER → forbidden; the actions return `{ ok: false, error }` with a plain message |
| `getViewer()` | app layout, dashboard, admin layout, sign-in and sign-up pages, personal reads in `queries.ts` | null for guests; personal reads return empty state instead of the demo user's |

The admin layout redirects an anonymous visitor to `/sign-in?next=/admin` and renders "Administrators only" for a USER; that is the experience, not the boundary. The boundary is `requireAdmin()` inside the loader and the actions, verified by calling the actions directly with a USER session and with no session.

Object-level ownership is unchanged: every personal row is keyed `(userId, targetId)` with `userId` from the session, so a user can only ever address their own rows. The two-user database test (`tests/db/user-isolation.test.ts`) writes as A, reads as B, and tries to remove and re-point A's rows as B.

## Anonymous visitors

Public catalogue pages (schedule, matches, teams, players, leagues, history, match detail) are unchanged. The dashboard shows the whole day's matches instead of a follow-filtered list, and its watchlist, following and reminder panels say "Sign in to …". The watchlist page and the header bell show a sign-in state. Follow, star and reminder controls stay visible; a click sends the visitor to `/sign-in?next=<current path>` instead of mutating anything (the client stores are `readOnly` for a null viewer, and the server would reject the write anyway). The sidebar footer shows "Sign in"; the Admin entry is hidden unless the viewer is an administrator. No anonymous database user is created, and nobody can sign in as the demo user because it has no credential row.

The `next` parameter is only honoured as a same-origin path (`safeNextPath`): no scheme, no `//host`, no control characters, never the auth or API routes.

## First administrator

There is no self-promotion and no first-user rule. An operator, with the database URLs in their shell, runs:

```
npm run admin:role -- grant someone@example.com
npm run admin:role -- list
npm run admin:role -- revoke someone@example.com
```

The account must already exist (the person signs up first); the script never creates users, never prints or accepts passwords, refuses placeholder users without a credential (the demo user), and the change applies on the person's next request because the role is read from the database on every session lookup. No email address is hardcoded anywhere.

## Demo data

The seed still creates `demo-user` (`guest@matchbase.app`, name "Guest") with its follows and watchlist, as fixture data for screenshots and the reminder tests. It has no `Account` row, so it cannot sign in, and it is never attached to a real account. Real users start empty. The seed does not touch `role`, `Session`, `Account` or `Verification`.

## Preview and Production isolation

Explicit intent only: `resolveRuntimeEnvironment` reads `VERCEL_ENV` (then `NODE_ENV`); nothing parses connection strings. On a Preview deployment `providerSyncPolicy` refuses provider syncs (cron route answers 403 after the secret check; Admin "Sync now" returns "Sync not run") unless `ALLOW_PREVIEW_PROVIDER_SYNC=true` is set for a preview that has its own Neon branch. Sign-in and sign-up work on previews, with the preview URL as base URL.

Recommended Vercel variable scopes:

| Variable | Production | Preview | Development |
|---|---|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | production branch | a per-preview or staging Neon branch, never production | `.env.local` |
| `BETTER_AUTH_SECRET` | its own value | a different value | `.env.local` |
| `BETTER_AUTH_URL` | optional (derived) or the custom domain | leave unset (derived from `VERCEL_URL`) | unset |
| `CRON_SECRET` | required | unset (the route then answers 503) | `.env.local` |
| `ALLOW_PREVIEW_PROVIDER_SYNC` | unset | unset unless the preview owns its branch | unset |
| `AUTH_ALLOW_SIGN_UP` | as desired | as desired | unset (open) |

## Local-development quick sign-in (optional)

Two buttons on `/sign-in`, "Sign in as dev USER" and "Sign in as dev ADMIN", that exist only in a local development process. They are a convenience, not a bypass: each button runs a Server Action that re-checks the policy, creates the account through Better Auth's sign-up API if it is missing (a real credential row with a scrypt hash), sets its role the way the operator CLI would, and then calls Better Auth's real `signInEmail`. The `nextCookies` plugin on the application instance forwards the resulting Set-Cookie to the browser, so the session is an ordinary database session; `getViewer`, `requireUser` and `requireAdmin` are untouched and a dev USER is still refused at `/admin`.

Activation rules (`lib/auth/dev-login.ts`, tested in `tests/auth/dev-login.test.ts`): the runtime environment must be `development` (refused for `VERCEL_ENV=production`, `VERCEL_ENV=preview` and `NODE_ENV=production`, whatever the flag says), `MATCHBASE_DEV_LOGIN` must be true, and `MATCHBASE_DEV_USER_EMAIL`, `MATCHBASE_DEV_USER_PASSWORD`, `MATCHBASE_DEV_ADMIN_EMAIL`, `MATCHBASE_DEV_ADMIN_PASSWORD` must all be set with policy-length passwords and different emails. Values live only in `.env.local`; the page shows roles and emails, never passwords. Because the policy refuses outside development, the accounts can only ever be created in the development database (`tests/db/dev-accounts.test.ts` covers creation, idempotence, role repair and sign-in). Verified in a browser against a normal dev server (buttons present and working) and against a dev server started with `VERCEL_ENV=preview` and the same `.env.local` (buttons absent).

Before this was added, session persistence itself was checked and found sound: the sign-in cookie carries `Max-Age=604800`, the Session row survives a dev-server restart and the same cookie still renders the signed-in dashboard, `BETTER_AUTH_SECRET` is file-stable, no seed, script or startup code deletes users or sessions, and the only cleanup that deletes accounts is the test suite's own `@example.test` addresses.

## Errors and logs

Better Auth's logger is routed through `redactSensitiveText` (the same scrubber the sync logs use) at `warn` level. Auth API errors reach the browser as `{ code, message }` from Better Auth's own vocabulary ("Invalid email or password"); the forms map codes to short messages and show a generic one otherwise. Server Actions return plain result objects for expected failures; a thrown `AuthorizationError` on a void action becomes a rejected action whose message Next.js masks in production. No handler prints credentials or form bodies; the database tests assert that a wrong-password response contains no Prisma, PostgreSQL or stack text.

## Tests

- `tests/auth/authorization.test.ts`: the anonymous / USER / ADMIN matrix for `assertUser` and `assertAdmin`, `toViewer` role collapsing, `safeNextPath` open-redirect cases.
- `tests/auth/auth-env.test.ts`: environment resolution, the Preview guard, base URL derivation, secret and base-URL requirements, trusted origins, the sign-up flag.
- `tests/api/cron-sync.test.ts`: a session cookie is not cron authentication; Preview 403 unless opted in; production unaffected.
- `tests/db/auth-accounts.test.ts` (real Better Auth against PostgreSQL): sign-up ignores a claimed role and stores a scrypt hash; duplicate, short-password and wrong-password responses; session issue, resolution to a Viewer, per-device sign-out; role grant and revoke visible immediately; self-update cannot change the role; the demo user cannot sign in; closed sign-up.
- `tests/db/user-isolation.test.ts`: two users in one rolled-back transaction; ownership, cross-user no-ops, independent reminders, unknown user ids.
- Browser (Playwright, 67 checks): anonymous states and redirects, direct Server Action probes for all eight actions as anonymous and as USER, sign-up → follow → reload → watchlist → reminder, sign-out and sign-in again, two users in separate contexts, operator grant → admin pages and a mock-source sync → revoke, three viewport widths with no horizontal overflow and no console errors.

## Limitations

- Email verification and password reset are implemented (Phase 10) and switched off in Production by `AUTH_EMAIL_VERIFICATION_ENABLED` and `AUTH_PASSWORD_RESET_ENABLED`; account deletion is still not exposed.
- `nextCookies` is now part of the application instance (not the tests'), which also makes Better Auth skip its session refresh during Server Component renders where no cookie can be written.
- Rate limiting: since 9.2 the auth endpoints use database storage shared by every instance (`RateLimit` table).
- Security headers and an enforced nonce CSP exist since 9.2.
- One database role for runtime and migrations until the Phase 9.3 runbook creates the runtime role (template in `prisma/sql/runtime-role.sql`).
- Sessions are not listed or revoked from a UI; sign-out is per device.
- The admin layout redirects to `/admin` after sign-in rather than the exact admin sub-page.
