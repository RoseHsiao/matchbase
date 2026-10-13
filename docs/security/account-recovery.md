# Account recovery and email infrastructure (Phase 10)

> **Status (2026-10-13).** Checkpoint **10.1, mail foundation, implemented**: provider-neutral `Mailer`, Resend / development-outbox / disabled / capture transports, environment parser, Preview recipient allowlist, recovery-token redaction, unit tests. **Nothing sends mail at runtime yet**: no code path constructs a mailer, Better Auth is unchanged, `/api/auth/request-password-reset` still answers 400 `RESET_PASSWORD_DISABLED`. Production recovery stays disabled; public sign-up stays closed. Next: 10.2 templates, 10.3 Better Auth wiring behind `AUTH_PASSWORD_RESET_ENABLED`.

Companions: [production hardening](production-hardening.md) (the operator reset that remains the recovery path today), [authentication and authorization](authentication-and-authorization.md), [environment matrix](../deployment/environment-matrix.md).

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Provider | **Resend**, over its HTTPS API with the platform `fetch` | plain JSON API, no SDK and no new dependency, sending-only keys scoped to a domain, free tier covers this volume. Postmark remains a drop-in second transport behind the same interface. |
| Abstraction | provider-neutral `Mailer` (`lib/mail/mailer.ts`) | password recovery (10A), email verification (10B) and match reminders (Phase 11) all send through it; no caller sees a Resend type. |
| Application URL | the existing Vercel Production URL, unchanged | `BETTER_AUTH_URL` stays derived from `VERCEL_PROJECT_PRODUCTION_URL`. Reset links will be built from that base URL, never from the request Host. |
| Sending domain | **required before real Production mail; not available yet** | a `*.vercel.app` host cannot carry SPF/DKIM. Resend's shared `resend.dev` sender only delivers to the account owner. The parser refuses to report Production recovery as available while `MAIL_FROM` is on `resend.dev`. |
| Production recovery | **disabled** | `AUTH_PASSWORD_RESET_ENABLED` is absent and nothing reads it yet. The operator command `npm run account:password` remains the recovery path. |
| Public sign-up | **closed** | `AUTH_ALLOW_SIGN_UP` stays absent; mail configuration never changes `isSignUpAllowed` (tested). |
| Email verification | **Phase 10B** | separate rollout. Prerequisite there: the existing ADMIN must be verified before `requireEmailVerification` is turned on, or it is locked out. |
| Reset ≠ verification | **a successful reset will not set `User.emailVerified`** | verification stays one explicit flow with its own semantics (10B), not a side effect of recovery. |
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
| recovery available (`passwordReset.enabled`) | flag + any deliverable transport | flag + Resend to the allowlist | flag + Resend + `MAIL_FROM` not on `resend.dev` |

The development outbox and the capture transport repeat the environment check in their own constructors. That is the boundary, so a hand-built configuration cannot get past it either. `MAIL_DAILY_CAP` (default 100, 1–10 000) is parsed now and enforced from 10.3; an invalid value is a warning and falls back to the default.

## Redaction (fallback only)

`redactSensitiveText` (lib/data/sync/redaction.ts), which already guards the Better Auth logger, sync logs and `logServerError`, now also masks:

- `#token=…`, `?token=…` and `&token=…` anywhere, including URL fragments, which `redactUrl` does not inspect;
- Better Auth's `/reset-password/<token>` path;
- `reset-password:<token>` verification identifiers;
- `re_…` Resend keys by prefix. `RESEND_API_KEY` is also caught by the existing `_API_KEY` name rule.

The primary control is not logging these values at all. Redaction exists for the unexpected error message that carries one anyway.

## Development use

Set in `.env.local`: `MAIL_TRANSPORT=dev-outbox` and `MAIL_FROM=MatchBase <dev@localhost.test>`. Messages appear in `.mail-outbox/`, which git ignores; the files are mode 0600. Nothing in 10.1 sends yet. The outbox is used from 10.3.

## Tests

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
- `tests/domain/sync-redaction.test.ts`: the recovery-token and Resend-key patterns, plus ordinary text that must stay untouched.

## Next checkpoints

- **10.2:** password-reset and password-changed templates (text and HTML, escaped, no remote assets).
- **10.3:**
  - add `sendResetPassword` behind `passwordReset.enabled`;
  - build the link with a fragment (`/reset-password#token=…`) from the base URL;
  - hash tokens at rest (`verification.storeIdentifier`), 30-minute TTL, `revokeSessionsOnPasswordReset`;
  - per-user throttle and daily cap;
  - background sending through `after()`;
  - disable the GET `/reset-password/:token` callback;
  - **no** `emailVerified` change.
- **10.4:** the pages.
- **10.5:** readiness checks and the runbook.
- Real Production mail waits for a verified sending domain.
