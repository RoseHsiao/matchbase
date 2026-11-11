# Production hardening (Phase 9.2)

Status: implemented and verified locally on 2026-09-18 (tests, a production-mode `next start` smoke test, simulated readiness checks). Nothing was deployed; no Production resource exists yet. The deployment itself is Phase 9.3 and follows [deployment/production-deployment.md](../deployment/production-deployment.md).

## Re-audit: what was actually required

The Phase 9.0 findings and the Phase 9.1 carry-overs, classified against MatchBase's real shape (one Next.js app on Vercel, one Neon database, a handful of users at launch, one live provider synced daily):

| Finding | Class | Outcome in 9.2 |
|---|---|---|
| Public sign-up without email lifecycle | A | closed by default outside development; server-side. Since 2026-11-10 it can be opened without verification only by two explicit flags (below) |
| No password recovery | A (policy) | operator reset command; no fake flow |
| Rate limiting memory-local | A for auth endpoints | database-backed limiter on the auth endpoints |
| No security headers | A | baseline headers on every response |
| No CSP | A | nonce-based CSP, enforced |
| Owner-level runtime database role | B | least-privilege role template, readiness verification; Neon creation is an operator step |
| Preview/Production isolation configuration-dependent | A | explicit database label, startup guard, operator confirmation |
| No production config validation | A | readiness evaluation at startup and as a command |
| Seed could run against Production | A | seed refuses Production unless doubly confirmed |
| Migration workflow undefined | A | guarded `prisma migrate deploy`, operator-controlled |
| Repeated Admin "Sync now" spends provider budget | B | cooldown from run history |
| Logo URL scheme unvalidated | B (small) | https-only at both write boundaries and at render |
| Unbounded public list reads | B | watchlist reads only saved matches; list reads capped |
| Error paths log raw errors | B | one redacting log helper; 404 / error pages |
| Rate limiting on user and admin mutations | C | authentication plus idempotency is the defence; documented |
| Pagination everywhere | C | deferred; bounds documented |
| Prisma CLI transitive advisories | C | reachability documented |
| Email verification and reset flows | implemented, switched off (Phase 10) | each behind its own switch; see [account-recovery.md](account-recovery.md) |

## Documentation verified before implementing

Read on 2026-09-18: Better Auth email/password (including `disableSignUp`, `sendResetPassword`, `revokeSessionsOnPasswordReset`), rate limiting (database storage, `rateLimit` table, key = IP + path, IP from `x-forwarded-for`, custom rules, built-in expiry of stored rows), options reference, Next.js integration; Next.js CSP guide (nonce via `proxy.ts`, dynamic rendering, `'unsafe-eval'` only in development), headers reference, instrumentation guide; Vercel environment variables (per-environment scoping, branch overrides), system environment variables (`VERCEL_ENV`), cron management (production only, `CRON_SECRET` as Bearer, no retries, best-effort delivery), response headers (HSTS `max-age=63072000` on every deployment), deployment protection (Standard Protection covers previews, production public); Neon roles and database access (SQL-created roles have only basic privileges, grant statements, default privileges); Prisma migrate deploy guidance and the Prisma 7 config reference (`datasource.url` for the CLI, `directUrl` removed, `.env` not auto-loaded).

Facts that shaped decisions: Better Auth's database rate-limit storage expires rows itself, so no cleanup job is needed; Vercel already sends HSTS; nonces require dynamic rendering, which every MatchBase page already has; Vercel cron only ever invokes Production; Prisma's own guidance is to run `migrate deploy` from automation with the direct connection, not `migrate dev` or `db push`.

## Launch sign-up policy: CLOSED

**Update (Phase 10, 2026-10-28):** the mail-dependent parts now exist and are off by default. The sign-up decision is `accountPolicy` (lib/auth/email-verification.ts): it opens sign-up only when `AUTH_ALLOW_SIGN_UP=true` **and** verification mail is on (`AUTH_EMAIL_VERIFICATION_ENABLED` plus a deliverable transport), and then it requires verification. Without verification mail, sign-up stays refused outside development and the readiness check fails. The paragraph below is the 9.2 record.

Mode A. There is no mail transport, so Mode B (verification, reset, non-enumerating responses, sender domain) cannot be built honestly. `isSignUpAllowed` (lib/auth/auth-env.ts) returns false outside local development unless `AUTH_ALLOW_SIGN_UP=true` is set explicitly; the value feeds Better Auth's `emailAndPassword.disableSignUp`, so `/api/auth/sign-up/email` answers 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED` regardless of what the page shows. The sign-up page renders "Account creation is not open" and the sign-in page says the same in its footer. Development keeps sign-up open so the form stays exercised; dev quick sign-in and the operator ADMIN grant are unaffected; the readiness check reports open sign-up in Production as a warning that names the recovery gap.

Enabling public sign-up later: add a mail transport, set `requireEmailVerification: true` with `sendVerificationEmail`, add `sendResetPassword` with `revokeSessionsOnPasswordReset: true`, wire the two forms, then set `AUTH_ALLOW_SIGN_UP=true`. No authorization code changes.

## Public sign-up without email verification (2026-11-10)

Status: implemented and tested locally against the Development database only. **Not enabled anywhere**: no Production or Preview variable was changed, and both stay closed until the operator sets the flags below.

Product decision: keep the public demo and let visitors create an account before mail exists. Because that removes the verification step, it is an explicit, two-flag operator decision instead of a single switch.

### Policy matrix (`accountPolicy`, lib/auth/email-verification.ts)

| Environment | `AUTH_ALLOW_SIGN_UP` | `AUTH_ALLOW_UNVERIFIED_SIGN_UP` | Verification mail on | Sign-up | Verification | `production:check` / startup guard |
|---|---|---|---|---|---|---|
| Production, Preview | unset / false | unset / false | any | closed | not required | pass (Production) / info (Preview) |
| Production, Preview | `true` | unset / false | no | **closed (refused)** | — | **FAIL**; the server refuses to start (Production and Preview) |
| Production, Preview | unset / false | `true` | any | **closed (refused)** | — | **FAIL**; the server refuses to start |
| Production, Preview | `true` | `true` | no | **open, unverified** | not required | **WARN**: unverified, no self-service recovery, enumeration, 5/IP/hour |
| Production, Preview | `true` | any | yes | open | **required** (the unverified flag has no effect, and the warning says so) | WARN (Production: release procedure) / info |
| Development | unset / `true` | ignored | no | open, unverified (unchanged) | not required | info |
| Development | `false` | ignored | any | closed (unchanged) | not required | info |

Only `true`, `1`, `yes` or `on` count as set. A half-configured policy fails on Preview too (`previewCritical`), so a Preview never serves a sign-up state that nobody chose.

What the open, unverified mode means:

- New accounts are always `USER`. `role` is a server-owned field (`input: false`). On sign-up Better Auth replaces a submitted `role` with the default. It ignores `emailVerified`, `id` and timestamps because they are not input fields, and it always writes `emailVerified=false`. `update-user` refuses `role` (400 `FIELD_NOT_ALLOWED`), drops `emailVerified`, and refuses an email change (`EMAIL_CAN_NOT_BE_UPDATED`).
- Tested in `tests/db/auth-accounts.test.ts`, `tests/db/public-sign-up.test.ts` and `tests/e2e/public-sign-up.test.ts`.
- Existing ADMIN accounts and the operator grant (`npm run admin:role -- grant`) are unchanged.
- Sign-up signs the account in at once (`autoSignIn`), and the form calls `announceAuthChange()` so other tabs follow.
- The sign-up form states that the address is not verified and that there is no self-service password reset, unless `AUTH_PASSWORD_RESET_ENABLED` is honoured. Recovery remains the operator command `npm run account:password`.
- The landing page, the demo banner and the sidebar offer "Create account" only while the policy is open. The auth server enforces the same policy through `disableSignUp`.

### Email enumeration: measured, not eliminated

Better Auth 1.7.5 (`api/routes/sign-up.mjs`) returns its "generic duplicate" response (200, no session, synthetic user) only when `requireEmailVerification` is on or `autoSignIn` is off. In the open, unverified mode neither holds, so `POST /api/auth/sign-up/email` leaks whether an address has an account:

| Signal | Existing address | New address |
|---|---|---|
| HTTP status | **422** | 200 |
| Body | `{"code":"USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"}` | `{ token, user }` |
| `Set-Cookie` | none | session cookie |
| Time (dev DB, Singapore, median of 3) | **~98 ms** (no password hash on this path) | ~521 ms (scrypt hash, user and session writes) |

The UI message is not the problem: the server response itself differs. Sign-in does not leak (unknown address and wrong password both answer 401 `INVALID_EMAIL_OR_PASSWORD`).

This cannot be removed while keeping unverified sign-up with automatic sign-in. Even a uniform response would leak through the next step: a new address yields a working session and an existing one does not, and an attacker can always try to sign in with the password they just chose.

Consequence: **anyone can test whether the ADMIN's address has an account**, at 5 tries per IP per hour (more with many IPs; see "Rate-limit client IP" for how the IP is decided). The address is not the password. Sign-in stays limited to 10 per IP per minute and passwords are scrypt-hashed, but a confirmed admin address makes phishing and credential-stuffing attempts better targeted.

Options, none of them taken unilaterally:

| Option | Removes the leak? | Cost / limit |
|---|---|---|
| A. Require verification (`AUTH_EMAIL_VERIFICATION_ENABLED` + a verified sending domain) | **yes** for sign-up (generic duplicate response, timing equalised by hashing) | needs the mail runbook; it is the designed end state |
| B. `autoSignIn: false` in unverified mode | status and body: yes. Timing: mostly. The sign-in probe: **no** | new users must sign in by hand; a code change that is not implemented here |
| C. Give the ADMIN account an unguessable address (an alias nobody can guess) | protects the one address that matters | operator action (`account:create` with the new address, `admin:role grant`, then revoke the old one); does not protect USER addresses |
| D. CAPTCHA / bot protection on sign-up | raises the cost of bulk probing | third-party dependency, privacy and CSP review |
| E. Tighter sign-up rate limit | slows probing | limits real sign-ups behind shared IPs; does not stop a distributed probe |

Recommendation: do not open Production with both flags until the user accepts the leak explicitly, ideally with C done first. The lasting fix is A.

### Migration risk: turning verification on later

Every account created in the unverified mode has `emailVerified=false`. With verification mail on, `accountPolicy` sets `requireEmailVerification: true` while sign-up is open. From then on every one of those accounts gets `EMAIL_NOT_VERIFIED` at sign-in, with a new link mailed only after a correct password, to an address that was never checked and may not belong to them.

**Setting `AUTH_EMAIL_VERIFICATION_ENABLED` is not a safe switch on its own.** With both sign-up flags still set, adding it (plus a transport) is the whole change, and at the next deployment every unverified account is locked out. `production:check` only **warns**: it reads variables, not the database, so it cannot count the affected accounts. The sign-up warning then says the unverified flag "has no effect".

Before switching verification on, decide one of the following:

- **Re-verification.** Each unverified user must confirm on next sign-in. Accounts with mistyped or fake addresses are locked out, and the operator reset or `account:verify` is the only way back.
- **Exemption (grandfathering).** Confirm the existing accounts once with `account:verify`, or with a bounded migration that marks accounts created before a cut-off date. This keeps access but certifies addresses nobody checked; Phase 11 reminder mail would then go to them.
- **Hybrid.** Grandfather sign-in, but send reminder mail only after an explicit confirmation.

None is implemented; the choice is the operator's. Whatever is chosen, the order is:

1. **Count.** Run a read-only count of accounts with `emailVerified=false` on the target database. `production:check --db` does not report this yet, so use a one-off read-only query by the operator. Also count accounts created while sign-up was open: those addresses were never checked, and some may be squatted.
2. **Protect the administrators.** Confirm every ADMIN with `account:verify -- confirm <email>` and check with `account:verify -- status`, or required verification locks them out.
3. **Apply the chosen policy** to the existing accounts (re-verify, grandfather, or hybrid). Remember that grandfathering certifies squatted addresses as well.
4. **Rehearse on Preview.** Run the same configuration change against a Preview branch holding unverified accounts. Confirm that an unverified account behaves as the policy says, and that the ADMIN still signs in.
5. **Change the variables in one release.** Set `AUTH_EMAIL_VERIFICATION_ENABLED` with a verified sending domain, and remove `AUTH_ALLOW_UNVERIFIED_SIGN_UP`, so the configuration states what is meant.
6. Smoke-test sign-in for an ADMIN, a grandfathered USER (if any) and a new sign-up.

### Database isolation guard (2026-11-10)

The label (`MATCHBASE_DATABASE_LABEL`) states which database a deployment *means* to use; it cannot see which database the connection strings actually reach. Three layers check that (`lib/env/database-identity.ts`):

1. **Endpoint allowlist.** `MATCHBASE_DATABASE_ENDPOINT` names the Neon endpoint id. `DATABASE_URL` must be on `<endpoint>-pooler` and `DATABASE_URL_UNPOOLED` on `<endpoint>`, in the same Neon domain. An `options=endpoint=…` parameter naming anything else fails.
   - A mismatch **fails** in Production and in Preview, where it is `previewCritical` and blocks startup.
   - Missing is a **failure** on Preview and only a **warning** in Production, so the next deploy does not take Production down before the variable is set there. It is informational in development.
2. **Production denylist.** The Production endpoints are written in the code: `ep-crimson-mouse-b3yykfxq` (branch `production`) and `ep-super-poetry-b37z6bie` (the pre-Phase-11 recovery branch, which holds a copy of Production data). They were confirmed against the Neon API on 2026-11-10.
   - Any environment other than Production that references one of them **fails** (`previewCritical`), whatever the label and the allowlist say. This also catches a Preview whose variables were all copied from Production.
   - Matching is by endpoint prefix, so the pooler host, Neon's compute-specific hosts (`<endpoint>-<binding>[-pooler]`) and an `options=endpoint=` parameter are all caught.
3. **Database identity marker.** Each database carries `COMMENT ON DATABASE <db> IS 'matchbase:<label>'`, set once by its owner.
   - `production:check --db` reads it with the runtime credential (`shobj_description`, readable by any role) and compares it with the label.
   - Absent or different **fails** on Production and Preview; a read that fails is a failure, never skipped.
   - It is **not** read at server startup.
   - Production does not carry the marker yet, so `production:check --db` reports `db-identity` FAIL there until the owner sets `'matchbase:production'` (a separate, approved Production step).

Readiness output names variables only, never a connection string, host or endpoint id. Tests: `tests/env/database-identity.test.ts`; a mutation check (empty denylist, no pooler rule) makes them fail.

Operator side: `~/.config/matchbase/preview.sh` (outside the repository) runs every Preview database command with these rules:

- from an emptied environment: every variable the calling shell exported is unset, and only the clean set is exported with shell builtins, so no value ever appears as a command-line argument;
- with every key name from `.env.local` and `.env` exported empty, so no loader can fall back to the Development database;
- with a strict env-file key allowlist;
- only after this guard passes.

### Preview build-only DATABASE_URL_UNPOOLED (2026-11-10)

Vercel's Preview scope keeps **no owner credential**.

- `DATABASE_URL` is the pooled URL of the least-privilege runtime role `matchbase_app`, the only connection the deployed Preview application makes (`lib/data/db.ts`).
- `DATABASE_URL_UNPOOLED` holds a **build-only placeholder**: a direct URL with no user name and no password, for the Preview endpoint's direct host and database `matchbase_preview`, with exactly `sslmode=require&sslaccept=strict&channel_binding=require`. The exact form is in [environment-matrix.md](../deployment/environment-matrix.md#preview-database_url_unpooled-a-build-only-placeholder-2026-11-10).

Why it exists:

- The build runs `prisma generate && next build`. `prisma.config.ts` sets `url: env("DATABASE_URL_UNPOOLED")`, and Prisma's `env()` throws `PrismaConfigEnvError` when the variable is missing or empty, so without a value the Preview build fails before `next build` starts (verified in an isolated snapshot on 2026-11-10).
- `prisma generate` with the current generator (`prisma-client`, no TypedSQL) reads the string and does not connect.
- No other code in the build or at runtime connects with it. The startup guard only inspects it: the endpoint against `MATCHBASE_DATABASE_ENDPOINT`, and the TLS parameters against the migration policy.

It is **not** a working connection string for migrations, seed, bootstrap or any operator command. It carries no credential, so it cannot authenticate as a role that requires a password. This is a property of the current value and setup, **not** a guarantee that nothing could ever use it, so treat it as configuration that must not be reused. Database work on the Preview database runs only through `~/.config/matchbase/preview.sh`, using `~/.config/matchbase/preview.env`. Never copy the Vercel placeholder locally as a migration URL.

**Changes that would make the placeholder be used for a real connection, and require the build to be re-reviewed first:**

1. Adding `prisma migrate deploy` (or any other Prisma command that connects) to `build`, `prebuild` or `vercel-build`.
2. Switching Prisma generation to `--sql` / TypedSQL, which connects to the database at generate time.

In either case the placeholder would most likely fail authentication and abort the build. **That is not a reason to put owner credentials into the Vercel Preview scope.** Run such steps from the operator shell instead, or change `prisma.config.ts` so that generation needs no URL. The latter is option B: proposed, **not implemented**. It would make it possible to remove the variable from Vercel.

**Production is not covered by this policy.**

- Vercel Production currently keeps its own `DATABASE_URL_UNPOOLED`, which the Production build needs for the same reason; its actual value was not verified in the 2026-11-10 audit.
- Even once option B is implemented, that does **not** approve removing the variable from Vercel Production. Removing it there needs its own assessment, verification of a Production build without it, and explicit approval.

### ADMIN grant safety (2026-11-10)

Nothing in the database records who registered an address. `account:create` and public sign-up both write a User and a credential Account through the same Better Auth path, and `emailVerified` is `false` for both. While unverified sign-up is open, anyone can therefore register the address an operator means to promote later. Before this change, `admin:role -- grant` would then have made the registrant (who set the password) an administrator.

`emailVerified=true` is not treated as proof either. It can be set by `account:verify`, by a verification link sent to a squatted address only if the attacker controls that mailbox, or by a future grandfathering migration.

**Design (no schema change):** `grant` re-establishes who holds the account instead of trusting its current credential.

- It requires a new password (`MATCHBASE_NEW_PASSWORD` or a hidden prompt; no TTY and no variable means refusal).
- In **one transaction** it re-keys the single email/password credential, revokes every session, deletes outstanding reset links, and sets `ADMIN`.
- After a fixed 2-second wait it revokes sessions a second time. This is a **risk-reduction measure, not a guarantee**: see "Known limitation" below.
- It refuses an account with any sign-in method other than exactly one credential, because such a method could not be re-keyed.
- An account that is already ADMIN is left untouched (no password asked, sessions kept), so existing administrators are unaffected. `revoke` is unchanged.

`account:create` refuses an address that already has an account. It says the account was not created by the command and may belong to someone else, and changes nothing.

The trust root is the operator's out-of-band handover of the new password, the same root `account:create` already relies on. The trade-off: promoting a person who signed up themselves now replaces their password, and the operator has to hand them the new one.

The alternative, a provenance column (`createdBy`/origin) that would let `grant` skip the re-key for operator-created accounts, needs a schema migration and a backfill decision for existing rows. It is proposed, not implemented.

Tested in `tests/db/admin-grant.test.ts` (Development DB):

- a pre-registered address: the squatter's session and password stop working, and only the operator's password signs in as ADMIN;
- no password, or a short one: nothing changes;
- `account:create` on a pre-registered address: refused, account untouched;
- the normal create-then-grant path;
- a repeated grant on an existing ADMIN: no-op, session kept; `revoke` still works;
- a second sign-in method: refused.

**Known limitation: the grant is not race-free.** A sign-in that verifies the old password just before the grant's transaction commits can still create its session after that transaction's revoke, and the session then acts with the ADMIN role.

- The second revoke after 2 seconds reduces this window. It does not close it: a sign-in that takes longer than the wait, or finishes after the second revoke, is not caught. The 2 seconds is a heuristic, not a measured upper bound.
- No test exercises concurrent sign-ins, so nothing shows the race is resolved. The tests above cover the sequential cases only.
- Until it is closed, grant when the address is not in use: preferably with public sign-up closed, or on an account the operator has just created with `account:create`. Afterwards, check `admin:role -- list` and the account's sessions.
- Closing the race fully needs a change to how sign-in and grant are ordered (for example, a lock or a session-creation check against a credential version). That is not designed or implemented.

### Rate-limit client IP (2026-11-10)

Better Auth 1.7.5 keys its limiter on the first header in `advanced.ipAddress.ipAddressHeaders` (default `x-forwarded-for`).

- Without `trustedProxies` it trusts only a **single-value** header. A chain resolves to no IP, and every request then shares one bucket per path (`no-trusted-ip`), so five sign-ups anywhere would close sign-up for everyone for an hour.
- With `trustedProxies` it walks the chain from the right, skipping listed proxy addresses. Vercel publishes no fixed edge range, so this cannot be configured safely.
- Its limiter runs **before** plugin `onRequest` hooks (`better-auth/dist/api/index.mjs`), so a plugin cannot correct the IP.

MatchBase therefore decides the IP at its own route boundary (`lib/auth/client-ip.ts`, applied in `app/api/auth/[...all]/route.ts` to every request, including the verify-email bridge):

- **On Vercel (`VERCEL=1`).** The rightmost valid entry of `x-forwarded-for`, then of `x-vercel-forwarded-for`, then `x-real-ip`. Vercel documents `x-forwarded-for` as the client's public IP and says it overwrites the header to prevent spoofing. If it ever appended instead, the rightmost entry is still the one it added. A client-forged left part is ignored. An invalid rightmost entry is never replaced by an entry to its left.
- **Anywhere else.** Nothing is trusted, because no proxy vouches for the header. The limiter falls back to the shared bucket: strict, never permissive. It is off in development anyway; a self-hosted deployment would need its own rule.
- The result goes into a private header, `x-matchbase-client-ip`, after any client-supplied copy is removed. Better Auth is configured to read **only** that header, so a forwarded header a client sends is never trusted on its own.
- The per-IP limits are unchanged: sign-up 5 per hour, sign-in 10 per minute. IPv6 is still grouped by /64.

Tests:

- `tests/auth/client-ip.test.ts`: rightmost selection, forged chain, forged private header, invalid entries, nothing trusted off Vercel, the wiring.
- `tests/db/auth-rate-limit.test.ts`: two clients behind the same forged chain get separate buckets, and no bucket is created for a forged address.
- `tests/db/public-sign-up.test.ts`: 5 then 429 through the boundary, keyed on the platform-observed address.

**Not confirmed locally (Preview verification item):**

- whether Vercel ever delivers a multi-value `x-forwarded-for`;
- whether a client can preset `x-vercel-forwarded-for` or `x-real-ip` (only consulted when the `x-forwarded-for` entry is unusable);
- the behaviour behind a proxy placed in front of Vercel. Vercel's docs say the header is then overwritten and external IPs are not forwarded, so all users would share that proxy's IP.

On Preview, inspect the derived `x-matchbase-client-ip` from two different networks (for example a temporary log of the derived value only, never the raw headers) before opening sign-up.

## First account and system bootstrap (Phase 9.3A)

With sign-up closed, the first Production account is created by `npm run account:create -- <email>`: Better Auth's own sign-up API on a server-side instance with sign-up allowed for that call only (same validation, same scrypt hash, same User and Account rows), role USER, the bootstrap session discarded, password from `MATCHBASE_NEW_PASSWORD` or a hidden prompt, never printed. `npm run admin:role -- grant` promotes it in a separate step and sets the password again (see "ADMIN grant safety"). Tested end to end in `tests/db/account-create.test.ts`, including sign-in on a closed-sign-up instance and the subsequent grant.

A migrated but empty database needs only the rows the code registries define: `npm run bootstrap:system` creates the six sports (lib/sports.ts) and one ACTIVE DataSource row per live provider binding in the sync registry (no mock feed unless `--include-mock`). Leagues, seasons, clubs, venues and matches come from the first provider sync. The demo seed is never used as bootstrap. Tested in `tests/domain/system-bootstrap.test.ts` and `tests/db/system-bootstrap.test.ts`.

## Password recovery

**Update (Phase 10):** self-service recovery exists behind `AUTH_PASSWORD_RESET_ENABLED` and is off in Production; the "Forgot password?" link appears only when it is on. The operator procedure below **stays** as an independent path that needs no mail. It now also invalidates the account's outstanding reset links. The 9.2 record follows.

No "Forgot password" link exists and none is faked. For the controlled first deployment, recovery is an operator procedure: `npm run account:password -- <email>` reads the new password from `MATCHBASE_NEW_PASSWORD` or a hidden prompt, hashes it with Better Auth's own `hashPassword` (scrypt, `better-auth/crypto`), verifies the hash with `verifyPassword`, writes it to the credential row, and revokes every session of the account. It prints a status line only. Against a production-labelled database it needs `MATCHBASE_OPERATOR_TARGET=production`. Tested end to end in `tests/db/account-password.test.ts`. When mail delivery is enabled, the self-service flow sits **beside** this command; it does not replace it. Phase 10: [account-recovery.md](account-recovery.md).

## Rate limiting

Threat model after 9.1:

| Boundary | Abuse | Primary defence | Application limit |
|---|---|---|---|
| `/api/auth/sign-in/email` | credential stuffing, brute force | scrypt, generic errors | 10 per IP per minute |
| `/api/auth/sign-up/email` | account flooding and address enumeration (when open) | closed at launch; opening without verification needs two flags and is reported as a warning | 5 per IP per hour (kept; it is also the only brake on enumeration) |
| `/api/auth/request-password-reset` | enumeration, mail flooding | identical answers, hashed single-use 30-min tokens; off unless `AUTH_PASSWORD_RESET_ENABLED` | 5 per IP per hour |
| `/api/auth/send-verification-email`, `/api/auth/verify-email` (POST bridge) | enumeration, mail flooding, token guessing | identical answers, signed 1-hour tokens; off unless `AUTH_EMAIL_VERIFICATION_ENABLED` | 5 per IP per hour; 10 per IP per 10 min |
| `/api/auth/change-password` | online guessing with a stolen session | session required | 5 per IP per 10 min |
| other auth endpoints | scraping, session churn | session required | 60 per IP per minute |
| follow, watchlist, reminder actions | write spam | `requireUser`, composite keys make writes idempotent, one row per (user, target) | none |
| Admin CRUD | tampering | `requireAdmin` | none |
| Admin "Sync now" | provider budget | `requireAdmin`, lock, provider pacing | cooldown (below) |
| cron | forged triggers | `CRON_SECRET`, recency gate, lock | none |
| public reads | expensive queries | bounded lists (below) | none |

Implementation: Better Auth's limiter with `storage: "database"` (`RateLimit` table, migration `20260918064459_auth_rate_limit`), enabled whenever the environment is not development, keyed by client IP and endpoint path, IP from `x-forwarded-for` as Vercel sets it. Every serverless instance shares the table, so enforcement is consistent; Better Auth deletes expired rows on its own. Server-side `auth.api` calls bypass the limiter by design (dev quick sign-in, tests). Verified through the real HTTP handler against PostgreSQL (`tests/db/auth-rate-limit.test.ts`: ten 401s then a 429 with a retry header, one shared row, another IP unaffected) and in the production-mode smoke test (429 after the allowance). No Redis: the auth endpoints see a few requests a minute, PostgreSQL handles that with one row per key.

## Admin "Sync now" cooldown

`manualSyncPolicy` (lib/data/sync/manual-sync-policy.ts) refuses a manual run while the source's last SUCCESS or PARTIAL run is younger than `SYNC_MANUAL_COOLDOWN_MINUTES` (default 10), unless the latest run FAILED, so recovery after a failure is never blocked, and a RUNNING run is left to the lock. It reads the newest sync logs; no new state. Applied in `runDataSourceSync` after authorization and the Preview guard and before `runSync`. The cron scheduler keeps its own 30-minute recency gate for duplicate deliveries. Tested at the exact boundary; verified in the smoke test (a second click answers "Sync not run: this source synced successfully …").

## Security headers

From `lib/http/security-headers.ts` through `next.config.ts` on every response, pages and API routes alike: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()`, `X-Frame-Options: DENY`, `X-DNS-Prefetch-Control: off`, and in production mode `Strict-Transport-Security: max-age=63072000; includeSubDomains` (matching Vercel's own value; `preload` left as a conscious operator decision). Verified with curl and the smoke test.

## Content Security Policy: ENFORCED, nonce-based

Resource inventory (every MatchBase page): scripts from this origin plus the inline bootstrap scripts Next.js and next-themes emit; one compiled Tailwind stylesheet plus inline `style` attributes (team colours, sidebar geometry, Base UI positioning); images from this origin, the avatar fallbacks, and team badges from `r2.thesportsdb.com`; fonts self-hosted by next/font; fetches to this origin only (auth endpoints, Server Actions, RSC payloads). No frames, objects, third-party scripts or analytics.

Policy (lib/http/csp.ts, generated per request by proxy.ts with a fresh nonce; pages are all dynamically rendered already):

```
default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; style-src 'self' 'unsafe-inline';
img-src 'self' data: https://r2.thesportsdb.com https://www.thesportsdb.com; font-src 'self'; connect-src 'self';
worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
```

Development adds `'unsafe-eval'` to scripts (React error stacks) and `ws: wss:` to connect (hot reload). `style-src 'unsafe-inline'` is the one concession: inline style attributes cannot carry nonces and the app's colour and layout code uses them; script injection, the directive that matters, has no unsafe source. Mode comes from `CSP_MODE` (enforce by default, `report-only` for a rollback, `off` refused by the readiness check in Production). The proxy skips `/api`, static chunks and image optimisation. next-themes receives the nonce through the root layout. Verified in production mode: zero console violations across every public page, the theme switch (inline script) works, all twenty provider badges load. No reporting endpoint was added; a rollback is `CSP_MODE=report-only`.

## Image and badge URLs

`sanitizeImageUrl` (lib/safe-url.ts) accepts only absolute `https:` URLs without credentials (`http:` only when the caller opts in, which TeamLogo does outside production). Applied where a URL enters the database (Admin `saveTeam`, which rejects with "Logo URL must be an https:// image address", and the sync pipeline's team upsert, which stores null instead) and again when rendering. Existing rows: all twenty badges are https on `r2.thesportsdb.com`; demo teams have none.

## Database privileges

Runtime SQL inventory: SELECT, INSERT, UPDATE, DELETE on every table (Prisma reads and writes, Better Auth's user/session/account/verification/rateLimit rows, the sync pipeline's upserts), `SELECT … FOR UPDATE` on `DataSource` (the run lock), interactive transactions, USAGE on sequences (none today). Nothing at runtime creates, alters or drops objects, and nothing writes `_prisma_migrations`.

Strategy: two credentials. `DATABASE_URL_UNPOOLED` stays on the owner role and the direct host for `prisma migrate deploy` and operator scripts; `DATABASE_URL` becomes a SQL-created role with only the data privileges, on the pooled host. `prisma/sql/runtime-role.sql` is the auditable template (placeholders, no password), including default privileges for tables that later migrations create. Verified locally only in the negative direction: `production:check --db` reports whether the runtime role owns the database or can CREATE in `public`, and that report currently warns for the development owner role. Creating the Neon role is an operator step in the runbook; the code does not assume any Neon role name. Limitation recorded honestly: until the runbook step is done, runtime and migrations share the owner credential.

## Database URL safety

Both variables are server-only (never `NEXT_PUBLIC_`, never imported by client code; the build-output scan checks the names and the values). The runtime client (lib/data/db.ts) reads only `DATABASE_URL`; the Prisma CLI (prisma.config.ts) reads only `DATABASE_URL_UNPOOLED`; scripts prefer the direct URL and never print either. The readiness check requires `sslmode=verify-full` on `DATABASE_URL` (honoured by `pg`) and exactly `sslmode=require&sslaccept=strict&channel_binding=require` on `DATABASE_URL_UNPOOLED`, because Prisma's migration engine ignores `verify-full` and verifies certificates only with `sslaccept=strict` (docs/deployment/production-deployment.md, "Connection TLS policy"). Error logging redacts connection-string passwords.

## Environment model and Preview isolation

`lib/env/runtime-environment.ts` is the single interpretation: `VERCEL_ENV` (production | preview | development), else `NODE_ENV=production` means self-hosted Production, else local development. Every policy asks it: sign-up, dev quick sign-in, provider sync on Preview, seed, operator confirmation, readiness.

The non-secret `MATCHBASE_DATABASE_LABEL` (development | preview | production) sits next to each `DATABASE_URL`. Production refuses to start unless it is `production`; Preview and development refuse to start if it is `production`; operator commands against a production-labelled database also need `MATCHBASE_OPERATOR_TARGET=production` on the command line. Code still cannot prove two URLs differ, so the runbook pairs this with Vercel variable scoping (separate Production and Preview values for the database URLs, `BETTER_AUTH_SECRET`, `CRON_SECRET`, the label) and a Neon branch per Preview.

| | Development | Preview | Production |
|---|---|---|---|
| database label | development | preview | production |
| auth secret | `.env.local` | its own | its own |
| dev quick sign-in | optional | refused | refused |
| public sign-up | open | closed | closed |
| provider sync | manual, mock | refused unless `ALLOW_PREVIEW_PROVIDER_SYNC=true` | scheduled and manual |
| `CRON_SECRET` | local smoke test | unset (route answers 503) | required |
| demo seed | allowed | allowed, noted | refused unless doubly confirmed |

## Production configuration validation

`evaluateProductionReadiness` (lib/env/production-config.ts) checks, from variables only: environment intent, database label, both database URLs (present, PostgreSQL, a hostname, each against its own TLS parameter policy: `verify-full` for the runtime URL, the Prisma migration-engine parameters for the direct URL, no duplicates or unexpected parameters), auth secret length and entropy, auth base URL (https outside loopback), `CRON_SECRET` (required in Production, should be unset on Preview), secret separation, sign-up policy, dev-login flags and credentials absent on deployments, `ALLOW_PRODUCTION_SEED` absent, Preview-sync flag placement, `CSP_MODE`, provider configuration for the scheduled source, sync cadence values. `instrumentation.ts` runs it once per server instance: Production refuses to start on any failure, Preview only on the checks that could reach Production (label, dev login, seed flag, secret reuse). Build-time module evaluation is skipped (`NEXT_PHASE`), and the auth route stays lazy. Verified: a production-mode server with `MATCHBASE_DEV_LOGIN=true` or without the label refuses to serve (500 with the named check in the log).

## Secrets

`BETTER_AUTH_SECRET`: at least 32 characters with at least 12 distinct ones (the check rejects repeated characters), generated with `openssl rand -base64 32`. `CRON_SECRET`: at least 16 characters, generated the same way. They must differ (checked), differ between Preview and Production (runbook), never be committed (`.env*` ignored except `.env.example`; tracked-secret scan). Rotation: set the new value in Vercel for the environment, redeploy; rotating the auth secret signs every user out; rotating the cron secret needs no other change because Vercel sends whatever is configured.

## Migrations

`npm run db:migrate` runs `scripts/migrate-deploy.mts`: `prisma migrate deploy` only (never `migrate dev`, `db push` or a reset, which the script refuses by argument), with the direct connection, refused against a production-labelled database without `MATCHBASE_OPERATOR_TARGET=production`. The build no longer migrates: Vercel's build runs `prisma generate && next build`, so a Preview build can never touch a database and a Production deploy never applies schema changes implicitly. The runbook sequence is: readiness check, `db:migrate` from an operator shell against Production, then deploy. Migrations are additive so the previous deployment keeps working during the window. Failure: Prisma records the failed migration; the operator fixes and re-runs or marks it with `prisma migrate resolve`; `production:check --db` reports unfinished or pending migrations.

## Seed safety

`seedPolicy` runs first in `prisma/seed.ts`, before any connection: refused for Production intent or a production-labelled database unless `ALLOW_PRODUCTION_SEED=true` and `MATCHBASE_OPERATOR_TARGET=production` are both set; Preview is allowed with a printed note; development unchanged. Verified with `VERCEL_ENV=production npx prisma db seed` (exit 3, no connection) and in tests.

## Operator commands

| Command | Guard | Prints |
|---|---|---|
| `npm run db:migrate` | operator confirmation on production label; refuses reset/push | migration names |
| `npm run db:seed` | seed policy | anchor and counts |
| `npm run admin:role -- grant/revoke/list` | operator confirmation on production label | emails and roles |
| `npm run account:password -- <email>` | operator confirmation on production label | status line |
| `npm run sync:manual -- <id>` | operator confirmation on production label; real provider call | run summary |
| `npm run bootstrap:system [-- --include-mock] [-- --dry-run]` | operator confirmation on production label | ids and counts |
| `npm run account:create -- <email>` | operator confirmation on production label | email, role, credential type |
| `npm run production:check [--db] [--env …]` | none; read-only | check lines |

None prints a connection string, a secret or a password. Automation stays possible: the confirmation is an environment variable, not an interactive prompt.

## Error redaction and logging

`logServerError(scope, error)` (lib/logging/server-log.ts) is the one operator-log path for unexpected errors: error class and message after `redactSensitiveText`, stack only outside production. Used by the admin actions, the cron handler and the dev quick sign-in; Better Auth's logger and the sync pipeline already used the same scrubber. User-facing messages stay the short fixed strings the actions return; Next.js masks thrown Server Action messages in production. Route error pages (`app/error.tsx`, `app/global-error.tsx`) show only a digest; `app/not-found.tsx` is static.

Logging policy: safe to log are sync status, source ids, health states, redacted error categories, check ids; never logged are tokens, cookies, passwords, secrets, connection strings; emails and user ids are logged only by operator commands that act on that account. No third-party logging or analytics.

## Public error behaviour (verified in production mode)

404 page without internals; anonymous personal actions redirect to sign-in (9.1); USER at `/admin` sees "Administrators only"; failed sign-in says "Email or password is incorrect"; disabled sign-up is refused server-side with a plain page; unexpected Server Action failures return fixed messages; a provider failure only changes a source's health, public pages keep serving persisted data.

## Dependencies

`npm audit` on 2026-09-18: 4 high, unchanged from 9.0, all in the Prisma CLI's transitive dependencies (`deepmerge-ts` via `@prisma/config`, `mysql2` via `prisma`). Reachability: both packages are used by the CLI (dev-time tooling) only; the runtime client uses `@prisma/client` with the `pg` driver adapter, and `mysql2` is never loaded. Mitigation: none needed at runtime; the CLI runs in trusted operator shells and the build. Upgrade path: a Prisma release that bumps the transitives; no downgrade or forced major change. No Better Auth advisory.

## Resource bounds

Watchlist page and dashboard preview now read only the viewer's saved matches (`getWatchlistMatches`) instead of the whole catalogue. `matchRepository.findViews` applies a default limit of 1000 rows to list reads without an explicit limit (Matches, History); the admin snapshot caps matches at 5000; monitoring queries keep their 10-per-source and 500-log bounds. Cursor pagination is deferred until a provider window makes any list approach these numbers.

## Remaining risks (intentionally deferred)

- Email verification and self-service password reset are implemented but stay off until a verified sending domain exists (Phase 10, [account-recovery.md](account-recovery.md)).
- The least-privilege runtime role must be created by the operator (template provided); until then runtime and migrations share the owner credential.
- `style-src 'unsafe-inline'` in the CSP.
- No pagination beyond the caps above.
- Rate limiting covers auth endpoints only; user and admin mutations rely on authentication and idempotency.
- Prisma CLI transitive advisories tracked, not fixed.
- HSTS `preload` not requested.
