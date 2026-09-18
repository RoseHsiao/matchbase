# Production smoke test (Phase 9.3 checklist)

Written 2026-09-18. To be executed against the Production deployment after the [runbook](production-deployment.md) steps 1 to 13. **Not executed yet.** The same checks passed locally in production mode (`next start`) during Phase 9.2, which is the evidence they are runnable.

Record for each item: pass / fail, the URL, and a note.

## Anonymous

- [ ] Dashboard loads; description says "Sign in to follow, save and set reminders"; today's matches shown publicly.
- [ ] Schedule, Matches, Teams, Players, History, a match detail page load.
- [ ] Team badges render (network tab: images from `r2.thesportsdb.com`, no CSP violation in the console).
- [ ] Follow, star and reminder controls redirect to `/sign-in?next=…`.
- [ ] `/watchlist` shows the sign-in state; the header bell says "Sign in to save matches".
- [ ] `/sign-up` says "Account creation is not open"; `POST /api/auth/sign-up/email` answers 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED` (launch policy).
- [ ] `/sign-in` has no "Development quick sign-in" section.
- [ ] Wrong credentials show "Email or password is incorrect."
- [ ] `/admin` redirects to `/sign-in?next=%2Fadmin`.

## USER

- [ ] Sign in; the sidebar shows the account; Admin is absent from the navigation.
- [ ] Dashboard shows personal panels; follow a team; reload; still followed.
- [ ] Star a match; `/watchlist` lists it; set a reminder; the bell counts it.
- [ ] `/admin` shows "Administrators only".
- [ ] Sign out returns to the anonymous shell; `/watchlist` shows the sign-in state.

## ADMIN

- [ ] Admin overview, Data Sources, Monitoring, Sync Logs load.
- [ ] A catalogue table (Teams) opens; editing a team with `javascript:` in Logo URL is refused with "Logo URL must be an https:// image address."
- [ ] Sync now on TheSportsDB: one run (SUCCESS or PARTIAL); a second click within 10 minutes answers "Sync not run: this source synced successfully …"; a run on a source that just failed is allowed.
- [ ] Two "Sync now" clicks in quick succession on one source: the second answers "Sync already running" (lock).

## SYSTEM

- [ ] `GET /api/cron/sync` without a header → 401; wrong secret → 401.
- [ ] With `CRON_SECRET` → 200 and a summary; a second call within 30 minutes reports `SKIPPED_RECENT` for the sources that just ran.
- [ ] Preview deployment: `/api/cron/sync` → 503 (no secret) and Admin Sync now → "disabled on Preview".

## SECURITY

- [ ] Response headers on `/dashboard`: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy` with camera/microphone/geolocation off, `Strict-Transport-Security`, `Content-Security-Policy` with a per-request nonce and `'strict-dynamic'`.
- [ ] Console shows no CSP violations on Dashboard, Teams, a match page, Admin Monitoring, sign-in.
- [ ] No dev quick login; `MATCHBASE_DEV_*`, `ALLOW_PRODUCTION_SEED`, `ALLOW_PREVIEW_PROVIDER_SYNC` absent from Production variables.
- [ ] Page source and JS chunks contain no `postgresql://`, secret values or dev credentials.
- [ ] A failed Server Action (for example an Admin save with an invalid record) shows a short message, never a stack or SQL.
- [ ] Eleven wrong sign-ins in a minute from one client → the eleventh answers 429.

## DATA

- [ ] `npm run production:check -- --env production --db` from the operator shell: READY, all migrations applied, runtime role cannot alter the schema (or the owner-role warning is recorded as the known open item).
- [ ] Catalogue intact: leagues, teams, matches counts match expectations; provider rows keep their external identities (Admin → Data Sources shows last sync).
- [ ] No demo user (`guest@matchbase.app`) and no `@matchbase.local` accounts, unless the seed was run deliberately.
- [ ] No RUNNING sync log older than 15 minutes.

## Desktop and phone

- [ ] The anonymous and USER checks above at 1280 px and at 390 px: no horizontal overflow, the bottom navigation works, the sign-in form fits.
