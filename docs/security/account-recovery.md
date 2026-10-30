# Account recovery and email infrastructure (Phase 10)

> **Status (2026-10-28, after the pre-release remediation).** Checkpoints **10.1–10.5 and 10.7 implemented and verified locally** (unit and database tests, headless-browser checks against the dev outbox). **10.6 (Preview real mail) is ready but not performed**: no real email has been sent or received. Every user-facing mail feature has its own switch: `AUTH_PASSWORD_RESET_ENABLED` for recovery and `AUTH_EMAIL_VERIFICATION_ENABLED` for confirmation links, which also gate the Watchlist reminder offer and open sign-up. A configured transport alone sends nothing to users. In Production: **no mail variables, recovery disabled, verification mail disabled, sign-up closed**. The build that contains these checkpoints also contains the Phase 11 migration, which must be applied **before** that build is deployed ("Release order" below).

Companions: [production hardening](production-hardening.md) (the operator reset that remains the recovery path today), [authentication and authorization](authentication-and-authorization.md), [environment matrix](../deployment/environment-matrix.md).

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Provider | **Resend**, over its HTTPS API with the platform `fetch` | plain JSON API, no SDK and no new dependency, sending-only keys scoped to a domain, free tier covers this volume. Postmark remains a drop-in second transport behind the same interface. |
| Abstraction | provider-neutral `Mailer` (`lib/mail/mailer.ts`) | password recovery (10A), email verification (10B) and match reminders (Phase 11) all send through it; no caller sees a Resend type. |
| Application URL | the existing Vercel Production URL, unchanged | `BETTER_AUTH_URL` stays derived from `VERCEL_PROJECT_PRODUCTION_URL`. Reset links will be built from that base URL, never from the request Host. |
| Sending domain | **required before real Production mail; not available yet** | a `*.vercel.app` host cannot carry SPF/DKIM. Resend's shared `resend.dev` sender only delivers to the account owner. The parser refuses to report Production recovery as available while `MAIL_FROM` is on `resend.dev`. |
| Production recovery | **disabled** | `AUTH_PASSWORD_RESET_ENABLED` is absent, so no reset hook is configured. The operator command `npm run account:password` remains the recovery path. |
| Public sign-up | **closed** | `AUTH_ALLOW_SIGN_UP` stays absent. Mail configuration never opens sign-up; open sign-up additionally needs verification mail (tested). |
| Email verification | **implemented in 10.7; own switch `AUTH_EMAIL_VERIFICATION_ENABLED`** | Separate from the transport so that configuring mail changes nothing for users until each feature is switched on. Before opening sign-up, the existing ADMIN must be confirmed, or required verification locks them out. |
| Operator commands and mail | **never send mail** | `account:create` overrides every mail variable of the operator shell (`MAIL_OFF_ENV`); `account:password` and `account:verify` build no auth instance at all (tested with a full Resend configuration in the shell). |
| Reset ≠ verification | **a successful reset will not set `User.emailVerified`** | verification stays one explicit flow with its own semantics (10B), not a side effect of recovery. |
| Reset link lifetime | **30 minutes**, single use | `PASSWORD_RESET_TOKEN_TTL_SECONDS` in lib/auth/password-policy.ts is the one value. The email wording reads it now; Better Auth's `resetPasswordTokenExpiresIn` will read it in 10.3, so the email can never promise a different lifetime than the server enforces. |
| Operator reset and the notice | **`npm run account:password` sends no email** | It stays an independent emergency path that works without mail; the operator tells the person directly. It does invalidate the account's outstanding self-service reset links: Better Auth's own `Verification` rows for the user are deleted in the same transaction, so no second token system is involved. Only the self-service reset (10.3) sends the password-changed notice. |
| Delivery persistence | **deferred to Phase 11** | no `EmailDelivery` table, no migration in Phase 10A. Outcomes are logged as one redacted line (`describeMailResult`); Phase 11's notification architecture will decide durable delivery records. |

## Architecture (10.1)

```
lib/mail/
  mailer.ts            MailMessage, MailResult, Mailer, message validation, describeMailResult
  mail-env.ts          pure parser: env → MailEnvConfig { environment, transport, passwordReset, dailyCap, issues }
  recipient-policy.ts  MAIL_ALLOWED_RECIPIENTS → { all | allowlist }, withRecipientPolicy(mailer, policy)
  create-mailer.ts     MailEnvConfig → the one Mailer (capture is unreachable from here)
  transports/
    resend.ts          fetch POST https://api.resend.com/emails, bounded timeout, status → category
    dev-outbox.ts      development only: writes .mail-outbox/<id>.json (+ .html), logs one line
    disabled.ts        answers { status: "disabled" }, never "sent"
    capture.ts         tests only: in-memory, scriptable answers, refuses production
```

**Contract.** `send(message)` never throws. A message has one recipient, a kind slug, a one-line subject and a plain-text body, and optionally HTML and an idempotency key for Phase 11 retries. It is validated before any transport sees it: one plain address, no CR/LF in the subject, size limits. The result is one of:

| Status | Meaning |
|---|---|
| `sent` | accepted (optional `providerMessageId`) |
| `suppressed` | recipient not allowlisted |
| `disabled` | mail off, with the reason |
| `failed` | with `category` and `retryable` |

**Failure categories.**

| Category | Cause | Retryable |
|---|---|---|
| `timeout` | no answer within 10 s | yes |
| `network` | the request never completed | yes |
| `auth-config` | 401/403: key, sender or domain | no |
| `rate-limit` | 429 | yes |
| `provider-4xx` | any other 4xx | no |
| `provider-5xx` | 5xx | yes |
| `transport-error` | the dev outbox could not write its file | no |
| `invalid-message` | refused before sending | no |

Transports never retry. Whether to retry is the caller's decision.

**What never leaves the Resend transport:**

- the API key, which travels only in the `Authorization` header;
- the request payload;
- the provider's response text. A failed response body is cancelled unread, and from a 2xx only a well-formed message id is kept.

No mail module logs a recipient, a subject, a body or a link. Callers log `describeMailResult(kind, result)`, for example `[mail] kind=password-reset transport=resend status=failed category=rate-limit retryable=true http=429`.

## Environment safety rules

`readMailEnv` never throws. An unsafe or incomplete combination falls back to the `disabled` transport and reports an `error` issue that names the variable, never its value.

| Rule | Development | Preview | Production |
|---|---|---|---|
| `MAIL_TRANSPORT` unset | disabled, no issue | disabled, no issue | disabled, no issue (valid today) |
| `dev-outbox` | allowed | refused → disabled | refused → disabled |
| `resend` | needs `MAIL_ALLOWED_RECIPIENTS` | needs `MAIL_ALLOWED_RECIPIENTS` | allowlist **refused** (a leaked Preview setting) |
| `capture` or any other value | refused | refused | refused |
| `MAIL_FROM` | address or `Name <address>`, one line | same | same |
| recovery available (`passwordReset.enabled`) | `AUTH_PASSWORD_RESET_ENABLED` + any deliverable transport | the flag + Resend to the allowlist | the flag + Resend from an own domain |
| verification mail (`emailVerification.enabled`) | `AUTH_EMAIL_VERIFICATION_ENABLED` + any deliverable transport | the flag + Resend to the allowlist | the flag + Resend from an own domain |
| a transport with neither flag | nothing user-facing is sent | same | same |

The development outbox and the capture transport repeat the environment check in their own constructors. That is the boundary, so a hand-built configuration cannot get past it either. `MAIL_DAILY_CAP` (default 100, 1–10 000) caps reminder emails per UTC day (Phase 11); recovery is governed by the per-IP auth limit. An invalid value is a warning and falls back to the default.

## Redaction (fallback only)

`redactSensitiveText` (lib/data/sync/redaction.ts), which already guards the Better Auth logger, sync logs and `logServerError`, now also masks:

- `#token=…`, `?token=…` and `&token=…` anywhere, including URL fragments, which `redactUrl` does not inspect;
- Better Auth's `/reset-password/<token>` path;
- `reset-password:<token>` verification identifiers;
- `re_…` Resend keys by prefix. `RESEND_API_KEY` is also caught by the existing `_API_KEY` name rule.

The primary control is not logging these values at all. Redaction exists for the unexpected error message that carries one anyway.

## Templates (10.2)

```
lib/auth/password-policy.ts   PASSWORD_RESET_TOKEN_TTL_SECONDS = 30 * 60
lib/auth/reset-link.ts        buildPasswordResetUrl(baseURL, token) / normalizePasswordResetUrl(url)
lib/mail/templates/
  render.ts                   EmailContent → plain text + minimal HTML; escapeHtml
  display-name.ts             greetingName(name) → safe greeting text or null
  password-reset.ts           passwordResetEmail({ to, resetUrl, name? }) → { ok, message } | { ok: false, reason }
  password-changed.ts         passwordChangedEmail({ to, name? }) → MailMessage
```

**Building the link is separate from rendering.** `buildPasswordResetUrl` produces `<base>/reset-password#token=<token>`:

- the base URL must be https, or http on a loopback host;
- the base URL may carry no credentials, query or fragment;
- the token must be 16–256 characters from `[A-Za-z0-9_-]`.

The reset template validates the link again with `normalizePasswordResetUrl`. Any other shape is refused with `invalid-reset-url` and never mailed: a query-string token, Better Auth's own `/api/auth/reset-password/<token>` link, other paths, extra fragment parameters, quotes, whitespace, or a `javascript:` or `data:` URL. The 10.3 wiring must therefore build the link itself and ignore Better Auth's `url` argument.

**Inputs are minimal.** The reset template takes the recipient, the link and an optional display name. The notice takes the recipient and an optional name. The recipient is used only as `MailMessage.to` and never appears in the subject or the content.

### Content

| | Password reset | Password changed |
|---|---|---|
| Subject | Reset your MatchBase password | Your MatchBase password was changed |
| Heading | Reset your password | Your password was changed |
| Body | a reset was requested for your MatchBase account; use the link to choose a new password | the password was just changed; no action needed if it was you |
| Action | one **Reset password** button (HTML); the full URL on its own line (text) | **none**: no link, no token, no sign-in URL |
| Lifetime | "This link expires in 30 minutes and can be used once." | n/a |
| If not you | ignore the email; "Your password stays the same unless you choose a new one with this link." | someone may have access: use "Forgot password?" on the sign-in page straight away, and secure the mailbox, since reset links go there |
| Footer | why the message was sent | why the notice was sent |

The wording promises only what exists:

- The notice names no support address or security contact, because none exists yet.
- "Forgot password?" is true wherever the notice is sent: the notice comes from the self-service reset, which ships with the forgot-password page behind the same switch (10.3/10.4).
- The reset email never suggests the password has already changed.
- Neither email names an internal component (Better Auth, Resend, tokens, the database).

### Escaping and security

- **Plain strings only.** The renderer accepts no markup, and every string, including the subject in `<title>`, the name and the href, goes through `escapeHtml` (`& < > " '`). No template has a path for unescaped interpolation.
- **Display names.** They are untrusted, and `greetingName` decides what is shown:
  - control characters and bidirectional overrides are removed;
  - whitespace is collapsed;
  - text is cut at 60 characters;
  - a name containing `@`, `://` or `www.` is dropped (greeting "Hi,"), so neither the recipient's address nor a lookalike link reaches the body.
- **Inert HTML.** No images, scripts, stylesheets, fonts, forms, comments, hidden preheader or metadata, and no tracking. The markup is inline-styled tables and paragraphs, and the only link is the reset action.
- **Where the reset URL appears.** Exactly once in the HTML (the href) and once in the text, never in the subject. Templates do not log. Output is deterministic (no timestamps or random ids).

## Better Auth integration (10.3)

`createAuth` (lib/auth/create-auth.ts) reads `readMailEnv(env)`. **Only when `passwordReset.enabled` is true** does it configure:

- `sendResetPassword` and `onPasswordReset`, from `createRecoveryHooks` in lib/auth/recovery.ts;
- `resetPasswordTokenExpiresIn: PASSWORD_RESET_TOKEN_TTL_SECONDS` (30 min);
- `revokeSessionsOnPasswordReset: true`.

Otherwise no hook exists, and Better Auth answers `400 RESET_PASSWORD_DISABLED` to every address alike. It stores no token and sends nothing. That is the Production state today.

Always on: `verification.storeIdentifier: "hashed"`, which stores identifiers as SHA-256 digests, so a database read does not yield a usable reset link.

| Concern | Behaviour |
|---|---|
| Token ownership | Better Auth generates, stores, expires and atomically consumes the token. MatchBase never creates or checks one. |
| Emailed link | `buildPasswordResetUrl(origin, token)`, built from the configured base URL (or Better Auth's own origin in local development). Better Auth's `url` argument is never mailed. |
| Who gets mail | only accounts with a `credential` row. A password-less user row is answered identically but receives nothing, because a reset would otherwise create a credential for it. |
| Enumeration | known, unknown and password-less addresses get the same status and body (tested). Sends run through Next.js `after()` (`advanced.backgroundTasks`), so the response does not wait for the provider. A failed send is logged and still answers generically. |
| Success | password updated, **every session of the account revoked**, every other outstanding reset row deleted, then the password-changed notice. `emailVerified` is **not** touched. |
| Notice scope | only `onPasswordReset`, which runs only for the self-service reset and only when recovery is enabled. `/change-password` and the operator `account:password` send nothing (tested). |
| Replay / expiry | a consumed or expired token is answered `400 INVALID_TOKEN` and changes nothing (tested). |
| Rate limits | unchanged. `/request-password-reset` 5 per IP per hour, the default 60 per minute elsewhere, all through Better Auth's database limiter (tested per IP). No second mechanism. |
| Blocked URL | `GET /api/auth/reset-password/<token>` (Better Auth's link, which redirects with `?token=`) answers 404 at the route boundary (lib/auth/blocked-auth-paths.ts). Better Auth's `disabledPaths` compares exact paths and cannot express it. |
| Logs | one `describeMailResult` line per send, or a fixed sentence. Never an address, link, token or body (tested). |

`MAIL_DAILY_CAP` is not applied to recovery: the per-IP limit is the recovery control, as decided for this phase, and no competing limiter is added. The cap is enforced by the Phase 11 notification pipeline.

Build note: the development outbox's directory call carries `turbopackIgnore`. Without it, importing the mailer into the auth route made Turbopack trace the whole project into the server bundle, even though the outbox refuses to exist outside development.

## Recovery UI (10.4)

| Surface | Behaviour |
|---|---|
| Sign-in | a "Forgot password?" link next to the password label, **only when recovery is available** (the same `readMailEnv(...).passwordReset.enabled` the auth server uses). |
| `/forgot-password` | if unavailable: "Password reset is not available", pointing to the operator, with no form and no pretend send. If available: an email form. Success reads "If an account exists for that address, a reset link is on its way", then the 30-minute lifetime and single use, and "Request another link". A rate-limit or network error is shown as an error, never as a confirmation. `noindex`. A signed-in visitor is redirected to the dashboard. |
| `/reset-password` | the server renders a neutral shell ("Checking your reset link…"). The client reads `#token=` once (`readResetTokenFromHash`), keeps it in a ref, removes the fragment with `history.replaceState`, and re-reads on `hashchange` when another link is opened in the same tab. The form has a new password and a confirmation, enforces 10–128 characters and a match, and calls `authClient.resetPassword({ newPassword, token })`, which POSTs `/api/auth/reset-password`. Success: "Password changed … signed out everywhere", then Sign in. Invalid, expired or used: "This reset link can't be used", with "Request a new link". `noindex`, `referrer: no-referrer`. |
| Redirects | `safeNextPath` never returns to `/forgot-password`, `/reset-password` or `/verify-email`. |

**Browser verification (2026-10-28).** Headless Chrome over the DevTools protocol, against `next start` with `VERCEL_ENV=development`, the dev outbox, and a throwaway local test account. All 26 checks passed:

- the sign-in link and the email field's autofocus;
- the empty-email error, and the same generic confirmation for a known and an unknown address;
- an outbox fragment link reached only the test account;
- the fragment is removed from the URL, and the token is **absent from the DOM and history state**;
- `no-referrer` and `noindex` meta tags;
- mismatch error, then a successful reset;
- the token **appears only in the body of the one `POST /api/auth/reset-password`**, in no URL or Referer;
- no third-party requests, no token in the console, no exceptions;
- the new password signs in and the old one is refused;
- a replayed, malformed or missing link shows "can't be used" with a new-link action, and a malformed fragment is removed too;
- keyboard order: email (autofocus), submit, back link;
- no horizontal scroll at 390 px on all three pages.

The server log held only `[mail] kind=… status=sent` and fixed `[auth]` lines: no address or token (checked by grepping for both). `GET /api/auth/reset-password/<token>` answered 404 over real HTTP.

## Readiness checks (10.5)

`evaluateProductionReadiness` (lib/env/production-config.ts), which backs `npm run production:check` and the startup guard, now evaluates `readMailEnv`:

| Check | Production | Preview | Development |
|---|---|---|---|
| `mail:<VARIABLE>` (one per parser error) | **fail** (blocks startup) | warn (the parser already fell back to disabled) | warn |
| `mail-transport` | pass when disabled or Resend | pass / warn | info for the outbox |
| `mail-domain` | info: **"Not checked here"**: that the domain is verified in Resend; confirm in the dashboard | same | n/a |
| `mail-secret-separation` | fail if `RESEND_API_KEY` equals the auth or cron secret | fail (preview-critical) | fail |
| `password-recovery` | pass when enabled or unrequested; **fail** when requested but undeliverable | warn | pass / info |
| `email-verification` | pass when enabled or unrequested; **fail** when requested but undeliverable | warn | pass / info |
| `--db`: `db-schema`, `db-table-privileges` | **fail** when an expected table (including `NotificationDelivery`) is missing, or the runtime role lacks SELECT, INSERT, UPDATE or DELETE on any application table, or privileges cannot be read | same | same |

Detail lines name variables and counts, never values or addresses (tested). The check reads variables only. It does not and cannot confirm DNS, Resend domain status or inbox delivery, and it says so.

## Release order and Production mail setup (operator, not performed)

**The migration comes before the build.** This build's Prisma client reads `User.reminderEmails` (migration `20261028080000_notification_delivery`). Better Auth's adapter selects every column of `User` for each session lookup. So **deploying this build to a database without the migration breaks sign-in and every signed-in page.** The migration is additive, and older builds keep working on a migrated database. Vercel deploys Production on every push to `main`, and migrations are a manual operator step. Therefore:

- **Preview:** run `npm run db:migrate` against the Preview branch database (label `preview`) **before** the branch's Preview deployment is used.
- **Production:** run `MATCHBASE_OPERATOR_TARGET=production npm run db:migrate` with the Production owner connection **before merging to `main`**. Then run `npm run production:check -- --env production --db` with the runtime `DATABASE_URL` and expect:
  - `db-migrations` pass, with all migrations applied;
  - `db-schema` pass, with `NotificationDelivery` present;
  - `db-table-privileges` pass.

  A privilege failure means the default privileges did not reach the new table. Re-run the grant loop in prisma/sql/runtime-role.sql as the owner role. The check never grants anything itself.

**Production today:** no mail variables, every mail feature off, the operator `account:password` path in use. Enabling mail takes these steps, in order; **none has been performed**:

1. **Domain.** Own a domain and choose a sending subdomain (for example `mail.<domain>`). Add it in Resend, publish the SPF, DKIM and DMARC records it lists (DMARC `p=none` at first), and wait until Resend shows the domain as *Verified*.
2. **Key.** Create a Resend API key with *sending access* restricted to that domain, used only for Production.
3. **Preview first.** Complete the Preview procedure (10.6) with a real inbox.
4. **Variables** (Vercel → Production): `MAIL_TRANSPORT=resend`, `MAIL_FROM=MatchBase <noreply@mail.<domain>>`, `RESEND_API_KEY` (sensitive). Leave `AUTH_PASSWORD_RESET_ENABLED` and `AUTH_EMAIL_VERIFICATION_ENABLED` unset.
5. **Check.** Run `npm run production:check` against the pulled Production variables. Expected:
   - no failures;
   - `mail-transport` pass;
   - `password-recovery` and `email-verification` pass, both disabled;
   - the `mail-domain` info line.
6. **Deploy and confirm nothing changed for users:**
   - no "Forgot password?" link;
   - `/api/auth/request-password-reset` answers 400 `RESET_PASSWORD_DISABLED`;
   - the Watchlist card says email delivery isn't available;
   - `/api/auth/send-verification-email` answers 400 `VERIFICATION_EMAIL_NOT_ENABLED`.

   With both switches off, a configured transport sends nothing to users.
7. **Enable recovery.** Set `AUTH_PASSWORD_RESET_ENABLED=true`, redeploy, and run the Production smoke test with the operator account:
   - request, receive, reset;
   - the old session is signed out, and a replay is refused;
   - an unknown address is answered the same;
   - logs are free of addresses and tokens.
8. **Enable verification mail** when wanted: `AUTH_EMAIL_VERIFICATION_ENABLED=true`. This turns on confirmation links and the Watchlist "Send confirmation link" action. It also lets confirmed users opt in to reminder emails, which are delivered only once a schedule exists (docs/notifications.md), so enable it together with, or after, the reminder schedule.

**Rollback**, at any step: unset the feature switch (`AUTH_PASSWORD_RESET_ENABLED` or `AUTH_EMAIL_VERIFICATION_ENABLED`) or `MAIL_TRANSPORT` (all mail off), then redeploy. Outstanding reset links stop working when recovery is off, because no hook consumes them, and they expire within 30 minutes. `account:password` works throughout and also invalidates any outstanding reset link of the account.

## Preview real-mail verification (10.6)

**Status: procedure ready; not performed.** Real-mail delivery is verified only when a person has run the steps below and confirmed receipt in a real inbox. Until then, everything above is verified with stubs and the dev outbox only.

**What is already proven without a network** (tests/db/preview-mail.test.ts): a Preview-shaped environment runs the real handler, `createMailer` and Resend transport, with only `fetch` stubbed.

- A non-allowlisted account gets the generic answer and **no outbound request**, logged as `status=suppressed` without the address.
- An allowlisted account produces exactly one request to `https://api.resend.com/emails`, carrying the fragment link built from the Preview URL.
- Logs hold only the outcome line.

No extra test path was added: the recovery flow itself is the Preview test. A separate "send test email" command would be a second way to send mail that needs its own guards.

**Sender options for Preview.** `resend.dev` is refused only in Production.

- **(a) No custom domain yet:** `MAIL_FROM=MatchBase <onboarding@resend.dev>`. Resend delivers this shared sender only to the Resend account owner's address, so the allowlist must be exactly that address.
- **(b) Domain verified:** `MAIL_FROM=MatchBase <noreply@mail.<domain>>`.

### Human procedure

1. **Resend:** create an account, or choose the domain for option (b) and wait for *Verified*. Create a sending-only API key for Preview, distinct from any future Production key.
2. **Preview database:** the Preview deployment uses its own Neon branch (label `preview`). With the Preview `DATABASE_URL_UNPOOLED` and `MATCHBASE_DATABASE_LABEL=preview`:
   - **first** apply the migrations: `npm run db:migrate`. A Preview build on an unmigrated branch cannot sign anyone in.
   - then create a test account: `npm run account:create -- <your inbox address>`. This sends no mail, whatever mail variables the shell holds. Sign-up stays closed.
3. **Vercel → Preview variables**, ideally scoped to one branch:

   | Variable | Value |
   |---|---|
   | `MAIL_TRANSPORT` | `resend` |
   | `MAIL_FROM` | (a) or (b) |
   | `RESEND_API_KEY` | the Preview key, marked sensitive |
   | `MAIL_ALLOWED_RECIPIENTS` | your inbox address, exactly |
   | `AUTH_PASSWORD_RESET_ENABLED` | `true` |
   | `AUTH_EMAIL_VERIFICATION_ENABLED` | `true` (for the confirmation and reminder checks) |
   | `CRON_SECRET` | **temporary**, only for the reminder check: a fresh random value (`openssl rand -base64 32`) used nowhere else, marked sensitive. The environment matrix forbids it on Preview otherwise; remove it afterwards. Provider sync stays refused on Preview regardless (`ALLOW_PREVIEW_PROVIDER_SYNC` unset). |

4. **Check:** `npm run production:check` with the Preview variables. Expected:
   - no preview-critical failure;
   - `mail-transport` reading "Resend, sending only to 1 allowlisted address";
   - `password-recovery` and `email-verification` pass;
   - a `cron-secret` warn, expected while the temporary secret is set.
5. **Deploy the branch** and open its URL. Deployment Protection may ask you to sign in to Vercel in the browser.
6. **Calling the cron route from a terminal** (reminder check). A protected Preview rejects requests without a Vercel session, so create a *Protection Bypass for Automation* secret (Project → Settings → Deployment Protection) and send it as a header. Read both values from your shell, never paste them into files or chat:

   ```sh
   curl -sS "https://<preview-deployment-host>/api/cron/notifications" \
     -H "Authorization: Bearer $PREVIEW_CRON_SECRET" \
     -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET"
   ```

   Expect `{"ok":true,"planned":…,"sent":…}`. A 401 means a wrong or missing cron secret. An HTML login page means the bypass header is missing or wrong.
7. **Run the checklist:**
   - [ ] Sign-in shows "Forgot password?".
   - [ ] Request a reset for the allowlisted address. The page shows the generic confirmation, and the email arrives. Check the sender, subject, button, plain-text URL, and the 30-minute wording.
   - [ ] Message headers show SPF and DKIM pass (option b) and no tracking pixels or remote images.
   - [ ] Open the link. The address bar shows `/reset-password` with **no `#token`**.
   - [ ] Set a new password. "Password changed" appears, and a second browser that was signed in is signed out.
   - [ ] The password-changed notice arrives, with no link in it.
   - [ ] Open the same link again: "This reset link can't be used".
   - [ ] Request again, wait 31 minutes, open the link: "can't be used" (expiry).
   - [ ] Request a reset for a non-allowlisted address that has an account, and for an unknown address. Both show the same confirmation, and no email is sent. The log reads `status=suppressed` for the first.
   - [ ] Search the Vercel runtime logs for your address and for `token`. Nothing beyond `[mail] … status=sent|suppressed` lines.
8. **Record** the date, deployment and results here. Then **remove** the temporary `CRON_SECRET` and the bypass secret, and remove `AUTH_PASSWORD_RESET_ENABLED`, `AUTH_EMAIL_VERIFICATION_ENABLED` and `RESEND_API_KEY` from Preview or keep them branch-scoped.

## Email verification and sign-up policy (10.7)

**Token lifecycle: Better Auth's own.** Better Auth signs an HS256 token (`emailVerification.expiresIn = EMAIL_VERIFICATION_TOKEN_TTL_SECONDS`, 1 hour), verifies it and sets `User.emailVerified`. MatchBase stores no verification token. The differences from Better Auth's defaults are all about where the token travels:

| Concern | Behaviour |
|---|---|
| Emailed link | `buildEmailVerificationUrl` → `/verify-email#token=<jwt>`, https outside loopback; rendered by `emailVerificationEmail` ("Confirm your email for MatchBase", one **Confirm email** action, "expires in 1 hour"). Better Auth's `/api/auth/verify-email?token=…` link is never mailed. |
| Consuming | `GET /api/auth/verify-email` answers **404** at the route boundary. The page POSTs `{ token }` to `/api/auth/verify-email`, and `verifyEmailToken` (lib/auth/email-verification.ts) hands Better Auth the same GET **in-process**, so its rate limiter (10 per IP per 10 min) and checks run unchanged and the token never appears in a request URL. |
| Single use | Better Auth answers a replay with the same success as the first use. The bridge runs each call in an AsyncLocalStorage scope that `afterEmailVerification` marks, so the first use reports `verified` and any later use `TOKEN_ALREADY_USED` (tested). No second token store. |
| Sessions | `autoSignInAfterVerification: false`: a verification link never creates a session, first use or replay (tested). The person signs in afterwards. |
| Enumeration | duplicate sign-up gets Better Auth's synthetic response (same keys, `token: null`) and mails nobody. Unauthenticated `/send-verification-email` answers alike for unknown, unconfirmed and confirmed addresses (tested). The auth logger masks email addresses. |
| Not verification | requesting a link, password recovery and `account:create` never set `emailVerified`. Only the link, or the explicit operator command `account:verify`, does. |

**Account policy** (`accountPolicy`, used by the auth server, the sign-in and sign-up pages, and the readiness check):

| Sign-up requested (`AUTH_ALLOW_SIGN_UP` / dev default) | Verification mail (`AUTH_EMAIL_VERIFICATION_ENABLED` + a deliverable transport) | Result |
|---|---|---|
| no (**Production today**) | off / on | sign-up closed; verification **not required**, so the operator ADMIN (`emailVerified=false`) is never locked out; with verification mail on, a signed-in person can request a link |
| yes | on | sign-up open; **verification required**: no session at sign-up, sign-in answers `EMAIL_NOT_VERIFIED` and mails a new link after a correct password only |
| yes | off (with or without a transport), outside development | sign-up **refused** (the endpoint answers disabled; readiness fails in Production) |
| yes | off, development | open and unverified, as before (the local form stays usable without mail) |

**How unconfirmed users are restricted.**

- While sign-up is open, an unconfirmed account cannot sign in at all, so it has no session and no personal feature.
- While sign-up is closed, accounts are operator-created and may sign in unconfirmed. Email delivery of reminders (Phase 11) goes only to confirmed addresses.
- Development fixtures (dev quick sign-in) are marked confirmed, so they keep working when a local transport turns verification on.

**UI.**

- Sign-up with verification required shows "Check your email". The wording is the same for a new and an existing address.
- Sign-in shows "Confirm your email address first …" for `EMAIL_NOT_VERIFIED`.
- `/verify-email` uses the same fragment, ref and `replaceState` handling as the reset page, plus `hashchange`. Outcomes: "Email confirmed" → Sign in; "Already confirmed"; "can't be used".

**Browser verification (2026-10-28).** Headless Chrome against `next start` with sign-up open and the dev outbox. All 17 checks passed:

- "Check your email" with **no session cookie** (read through DevTools, since the cookie is HttpOnly);
- sign-in before confirming explains it and mails a second link;
- the fragment link is mailed;
- "Email confirmed", with the fragment removed and the token absent from the DOM;
- the token appears only in the body of `POST /api/auth/verify-email`;
- no console token or exceptions, and confirming did not sign in;
- a replay shows "Already confirmed", and a garbage link "can't be used";
- `GET /api/auth/verify-email?token=` answers 404;
- sign-in afterwards reaches the dashboard with a session;
- no horizontal scroll at 390 px.

The recovery browser checks were re-run in Production's shape (sign-up closed) with fresh browser profiles: all 30 checks passed.

### Opening public sign-up in Production: release procedure (human, **not performed**)

Sign-up is a separate release from recovery. **Nothing in the code opens it.**

1. Recovery is live in Production, with verified mail delivery (the runbook above, steps 1–7).
2. The Preview procedure (10.6) is repeated with sign-up open on Preview (`AUTH_ALLOW_SIGN_UP=true` scoped to the branch). Sign up, receive the confirmation, confirm, sign in; a duplicate address gets the same screen; an unconfirmed sign-in is refused.
3. **Confirm the operator accounts first.** Sign in as the ADMIN and request confirmation (once the Phase 11 settings page offers it), or run `MATCHBASE_OPERATOR_TARGET=production npm run account:verify -- confirm <admin email>` with the Production direct connection. Check with `account:verify -- status`. Without this, turning on required verification blocks the ADMIN's sign-in until they open an emailed link.
4. Decide the abuse posture (see "Residual risks"): the current controls are 5 sign-ups per IP per hour and required verification. A CAPTCHA (Better Auth's `captcha` plugin) would need CSP changes and a third-party script, so it is not added by default.
5. Publish a privacy notice for stored accounts, which public sign-up makes necessary.
6. With `AUTH_EMAIL_VERIFICATION_ENABLED=true` already live (step 8 of the mail runbook), set `AUTH_ALLOW_SIGN_UP=true` for Production and redeploy. `production:check` then reports `sign-up` as a **warn** ("OPEN … required email verification"). It reports a **fail**, and sign-up stays refused, if verification mail is off.
7. Smoke-test: sign up with a fresh inbox, confirm, sign in. **Rollback:** unset the variable and redeploy.

## Pre-release remediation (2026-10-28)

Findings of the read-only pre-release audit, fixed in code and tests:

| Finding | Fix | Test |
|---|---|---|
| `account:create` passed the operator shell's mail variables to its auth instance (a verification hook ran and stopped only because the shell had no base URL) | `MAIL_OFF_ENV` overrides every mail variable for that instance | tests/db/account-create.test.ts: full Resend configuration plus an allowlist for the new address in the shell, with a preloaded `fetch` recorder. No request is attempted and no mail hook runs. The test failed before the fix. |
| A configured transport switched verification mail and the Watchlist offer on by itself | `AUTH_EMAIL_VERIFICATION_ENABLED`; open sign-up now also needs it | tests/auth/account-policy.test.ts, tests/env/production-readiness.test.ts, tests/db/email-verification.test.ts ("a transport without the verification switch …") |
| `account:password` left outstanding reset links usable | deletes the user's reset rows in its transaction | tests/db/account-password.test.ts: an issued link answers `INVALID_TOKEN` after the operator reset. The test failed before the fix. |
| `production:check --db` did not know `NotificationDelivery` or check runtime privileges | lib/env/db-readiness.ts: read-only `has_table_privilege` per privilege, per table | tests/env/db-readiness.test.ts |
| The release order allowed deploying before migrating | "Release order" above | — |

Resend 409 handling and the notification run budget are recorded in docs/notifications.md.

## Development use

Set in `.env.local`: `MAIL_TRANSPORT=dev-outbox` and `MAIL_FROM=MatchBase <dev@localhost.test>`. Messages appear in `.mail-outbox/`, which git ignores; the files are mode 0600. Nothing in 10.1 sends yet. The outbox is used from 10.3.

## Tests

- `tests/mail/templates.test.ts`:
  - exact plain-text bodies for both emails;
  - the one HTML action, the 30-minute wording read from the constant, and where the URL appears (count and subject);
  - no recipient in the content, and no markup that loads, runs or hides anything;
  - escaping of malicious-looking names, and dropping link- or address-like names;
  - refusal of malformed or unsafe reset URLs, and link-builder rules;
  - the notice contains no link, token or invented contact;
  - output is deterministic and compatible with `MailMessage` through the capture transport;
  - global `fetch` replaced with a thrower.

- `tests/mail/mail-env.test.ts`:
  - the configuration matrix for each environment;
  - dev outbox refused outside development;
  - Production cannot use the dev outbox and refuses an allowlist;
  - Preview Resend requires an allowlist;
  - header-injection attempts in `MAIL_FROM`;
  - recovery availability, including refusal of the `resend.dev` sender;
  - the sign-up policy is unaffected.
- `tests/mail/transports.test.ts`:
  - the Resend request shape through a stub `fetch`. Global `fetch` is replaced with a thrower, so any real network access fails the run;
  - 401, 403, 429, 400, 422, 500 and 503 mapping;
  - timeout and network failures;
  - provider body never read and no sensitive value in the result or log line;
  - the allowlist sits in front of `fetch`;
  - disabled, capture and dev outbox behaviour.
- `tests/db/password-recovery.test.ts` (real handler, development database, capture mailer, global `fetch` replaced):
  - identical answers for known, unknown and password-less addresses;
  - hashed storage, the 30-minute expiry and the fragment link;
  - a valid reset revokes sessions, sends one notice and leaves `emailVerified` unchanged;
  - replay, expiry and sibling-link invalidation;
  - a mail failure still answers generically and logs safely;
  - no notice from `/change-password`;
  - with recovery disabled, every address gets the same refusal;
  - the per-IP limit holds, and the GET link is blocked.
- `tests/auth/recovery-ui.test.ts`: fragment parsing, redirect exclusions, error wording, and server-rendered markup (the reset shell has no form or token; the unavailable state has no form and no fake confirmation).
- `tests/env/production-readiness.test.ts` ("mail and password-recovery readiness"):
  - today's Production passes;
  - an own domain with recovery on passes, and says what it did not check;
  - nine unsafe Production combinations fail and block startup;
  - Preview allowlist rules, and no addresses printed;
  - development is information only, and the key is never printed.
- `tests/db/preview-mail.test.ts`: the Preview configuration end to end with a stubbed `fetch`: suppression before any request, one Resend request for the allowlisted address, outcome-only logs.
- `tests/db/email-verification.test.ts`:
  - open sign-up requires verification (no session, one fragment link);
  - duplicate sign-up is answered alike with no address logged;
  - an unconfirmed sign-in is refused, and only a correct password mails a new link;
  - valid once, then a refused replay with no session;
  - expired, malformed, foreign-signature and unknown-account tokens are refused;
  - resend answers alike;
  - with sign-up closed, an unconfirmed operator ADMIN signs in and can confirm on request;
  - without mail, verification is refused and Production sign-up stays closed;
  - the GET endpoint is blocked.
- `tests/auth/account-policy.test.ts`: the policy matrix, the verification link rules and the template.
- `tests/db/account-verify.test.ts`: the operator guard, status, a single confirm that changes nothing else, and idempotence.
- `tests/domain/sync-redaction.test.ts`: the recovery-token and Resend-key patterns, plus ordinary text that must stay untouched.

## Next checkpoints (as planned in 10.1; superseded by the sections above)

- **10.3:**
  - add `sendResetPassword` behind `passwordReset.enabled`;
  - build the link with `buildPasswordResetUrl(baseURL, token)`, ignoring Better Auth's `url`, and render it with `passwordResetEmail`;
  - hash tokens at rest (`verification.storeIdentifier`), `resetPasswordTokenExpiresIn: PASSWORD_RESET_TOKEN_TTL_SECONDS`, `revokeSessionsOnPasswordReset`;
  - send `passwordChangedEmail` from `onPasswordReset`;
  - per-user throttle and daily cap;
  - background sending through `after()`;
  - disable the GET `/reset-password/:token` callback;
  - **no** `emailVerified` change.
- **10.4:** the pages.
- **10.5:** readiness checks and the runbook.
- Real Production mail waits for a verified sending domain.
