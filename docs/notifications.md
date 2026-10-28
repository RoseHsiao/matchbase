# Notifications and reminder delivery (Phase 11)

> **Status (2026-10-28).** Implemented and tested against the development database with a capture mailer: a durable, idempotent match-reminder pipeline, an opt-in preference, the reminder email and an authenticated delivery route. **Not scheduled and not live:** the route is not in `vercel.json`, because the Hobby plan allows only daily crons, which cannot deliver "15 minutes before". **Real delivery is not verified:** no real inbox has received a reminder (needs the Preview mail procedure in [security/account-recovery.md](security/account-recovery.md)). Production migration **not applied**.

Companions: [watchlist-reminders.md](watchlist-reminders.md) (the preference model this builds on), [scheduled-sync.md](scheduled-sync.md) (cron authentication), [security/account-recovery.md](security/account-recovery.md) (the mail foundation and verification).

## Product loop

Discover → Follow → Schedule → Watchlist → **Reminder → (email)** → Watch → History. Phase 6A stored *when* to be reminded and showed it in the app (the header bell). Phase 11 adds one channel, email, for people who opt in.

## Preferences (defined before the schema)

| Preference | Where | Default | Meaning |
|---|---|---|---|
| Per-match offset | `UserWatchlistMatch.reminder` (existing) | `OFF` | when the reminder fires, relative to the start |
| Email channel | `User.reminderEmails` (new) | `false` | email the reminders the user set; in-app display is unaffected |

Rules:

- **Email only to a confirmed address** (`emailVerified`) on a deployment with a mail transport. The switch refuses to turn on otherwise; turning it off always works.
- No per-match channel choice, no quiet hours, no per-user time zone. Each would be a new preference with its own semantics. The presentation zone is **not** a substitute for a user's zone; the email names the zone instead (below).

## Delivery semantics

- **When.** `dueAt = startsAt − offset` (`getReminderAt`, the same arithmetic the app shows), in UTC, with no zone involved.
- **Eligibility.** A reminder is deliverable when all of these hold:
  - the match is `UPCOMING` (the stored status; transitions belong to the sync);
  - it is due: `now ≥ dueAt`;
  - it is not more than **15 minutes late** (`MAX_LATENESS_MS`);
  - for an offset reminder, the match has not started.

  An at-start reminder may go out at kick-off within the same window. There is no cancelled status in the model; a match that leaves `UPCOMING` is never reminded.
- **Never late, never twice.** A reminder that missed its window is skipped (`late`), not sent late. The unique key (user, match, kind, dueAt) allows one intent per reminder. A rescheduled match or a changed offset gives a new `dueAt`, hence a new intent, and the old one is skipped at send time.
- **Time in the email.** Written in the presentation zone **with the zone named**, for example "Sun, Nov 1, 7:30 PM GMT+8 (Asia/Taipei)" (`formatKickoffWithZone`), because the reader may be anywhere.

## Why a new table, and only one

| Need | Can `UserWatchlistMatch` carry it? |
|---|---|
| state per *scheduled instant* (reschedule = new reminder) | no: one row per (user, match) |
| claim lease, attempt count, next retry, terminal outcome, provider id | only by adding ~7 delivery columns to a preference row |
| survive the preference changing mid-delivery | no: saving/removing rewrites or deletes the row |

So: **`NotificationDelivery`** (migration `20261028080000_notification_delivery`) plus one column, `User.reminderEmails`. Intent, attempt state and result are explicit columns of the one row:

| Concern | Columns |
|---|---|
| intent | `kind`, `reminder`, `dueAt`, unique (`userId`, `matchId`, `kind`, `dueAt`) |
| attempt | `status`, `attempts`, `nextAttemptAt`, `leaseUntil` |
| result | `sentAt`, `providerMessageId`, `lastErrorCategory`, `outcomeReason` |

A separate attempts table was not needed: with at most 3 attempts, the counter plus the last error category says enough. **No address, name, content or token is stored** (tested). Rows cascade with their user and match.

States: `PENDING → SENDING → SENT`, or `SENDING → RETRY → SENDING …`. Terminal states:

- `SENT`;
- `SUPPRESSED` (recipient policy);
- `SKIPPED`, with reason `late`, `rescheduled`, `reminder-changed`, `opted-out`, `email-unconfirmed`, `match-not-upcoming`, `match-started` or `not-watchlisted`;
- `FAILED`, with reason `permanent-failure`, `attempts-exhausted` or `mail-disabled`.

## Pipeline (lib/notifications/delivery.ts)

Each run goes through four stages:

1. **Plan.** Select watchlist rows that meet all of these:
   - a reminder is set;
   - the user opted in and is confirmed;
   - the match is `UPCOMING` within the 24 h + 15 min horizon (at most 500 rows per run).

   Each eligible row becomes an intent via `createMany(skipDuplicates)`, which is idempotent under concurrent runs (tested with three at once).
2. **Sweep.** `PENDING`/`RETRY` rows past the lateness window become `SKIPPED(late)`.
3. **Claim.** `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED LIMIT n)` takes due `PENDING`/`RETRY` rows, and `SENDING` rows whose 5-minute lease expired. It sets `SENDING`, sets a lease and counts the attempt. Concurrent runs claim disjoint rows (tested: four runs at once send exactly one email). The batch size is `min(50, MAIL_DAILY_CAP − sent today (UTC))`.
4. **Send.** First re-check against current data: still watchlisted with the same offset, the same start, still opted in and confirmed, still eligible. Then send with **`idempotencyKey = notification:<id>`**, which goes to Resend as the `Idempotency-Key` header. A retry after an ambiguous failure (a timeout after the provider accepted) therefore reuses the key, and the provider de-duplicates instead of sending twice (tested: every attempt carries the same key). The outcome is written **only if this run still holds the lease** (`WHERE status = SENDING AND leaseUntil = <its lease>`), so a run that stalled past its lease cannot overwrite the run that reclaimed the row (tested).

**Retries.** Only retryable categories retry: timeout, network, rate-limit and provider-5xx. The backoff is 1, then 2 minutes, with at most **3 attempts** before `FAILED(attempts-exhausted)`. `auth-config`, `provider-4xx` and `invalid-message` fail at once. Within the 15-minute window, nothing retries forever and nothing is sent late.

**Logs.** One `describeMailResult` line per send, plus `[notifications] run planned=… sent=… …`. Counts only, never an address or content (tested).

## Route and scheduling

`GET /api/cron/notifications` (app/api/cron/notifications/route.ts → lib/api/cron-notifications.ts) works like this:

- It uses the same `Authorization: Bearer <CRON_SECRET>` check as the sync cron: 503 without a configured secret, 401 when wrong (tested, also over real HTTP).
- When mail cannot be delivered, it answers `skipped: "mail-disabled"` without planning anything.
- Its response is counts only, with `cache-control: no-store`.

**Scheduling is a human decision, not done:** reminders need a run every 5 minutes or so. Options:

- **(a)** Vercel Pro, adding `{ "path": "/api/cron/notifications", "schedule": "*/5 * * * *" }` to `vercel.json`;
- **(b)** an external scheduler (GitHub Actions, cron-job.org) calling the route with the secret.

Adding a sub-daily cron on Hobby fails the deployment, so it is not in `vercel.json`. A daily run would skip nearly every reminder as late, by design.

## UI

The Watchlist page has an **Email reminders** card (components/notifications/reminder-email-settings.tsx). It has four states:

- mail unavailable: "Email delivery isn't available on this deployment", with no switch;
- unconfirmed: "Confirm \<address> …" with **Send confirmation link** (Better Auth's signed-in `send-verification-email`);
- confirmed, off: "Reminders are shown in the app only" with **Email me my reminders**;
- confirmed, on: "Reminders are emailed to \<address> …" with **Turn off email reminders**.

The switch is a button with `role="switch"` and `aria-checked`. The server action `setReminderEmailsEnabled` takes the user id only from the session.

**Browser verification (2026-10-28).** Headless Chrome, `next start` with the dev outbox and sign-up closed. All 17 checks passed:

- the unconfirmed state, with no switch shown;
- confirmation sent, then mailed, then confirmed through `/verify-email`;
- the off state, then on, persisted across a reload, then off again;
- no horizontal scroll at 390 px and no console exceptions;
- the cron route answers 401 without a secret and with a wrong one, and runs with the right one.

## Tests

- `tests/notifications/policy-and-template.test.ts`:
  - exact eligibility and lateness boundaries, and at-start;
  - live and finished matches are never reminded;
  - due instants across Taipei midnight, and the zone-named time;
  - the UTC cap day, and the backoff;
  - email content, phrasing, escaping and cleaning of provider names, and safe links.
- `tests/api/cron-notifications.test.ts`: authentication before any work, the mail-disabled no-op, the injected clock, a fixed crash message.
- `tests/db/notification-delivery.test.ts`:
  - sends once at the due time, with a link and an idempotency key;
  - idempotent concurrent planning, and exactly-once concurrent delivery;
  - retry with backoff and the same key, bounded attempts;
  - retried success, permanent failure and suppression;
  - lease reclaim with fencing;
  - send-time re-checks: six reasons;
  - no planning for live matches or unconfirmed or opted-out users, and late rows expire;
  - at-start reminders, the daily cap, two-user isolation, the preference rules, metadata-only rows.

## Production rollout (human, **not performed**)

1. `MATCHBASE_OPERATOR_TARGET=production npm run db:migrate` with the Production direct connection. The migration is additive: a new enum, a defaulted column, a new table. The runtime role receives privileges on the new table through the default privileges set in 9.3B; confirm with `npm run production:check -- --db`.
2. Mail live in Production (account-recovery runbook) and verified in Preview **with a real reminder**: set a 5-minute reminder on a match about 10 minutes away, opt in, call the route with the secret, and receive the email.
3. Choose the scheduling option (a) or (b), set it up, and watch `[notifications] run …` lines for a day.
4. **Rollback:** remove the schedule. The table and column are inert without it, and opted-in users simply stop receiving email.
