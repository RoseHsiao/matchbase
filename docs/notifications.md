# Notifications and reminder delivery (Phase 11)

> **Status (2026-10-28).** Implemented and tested against the development database with a capture mailer: a durable, idempotent match-reminder pipeline, an opt-in preference, the reminder email and an authenticated delivery route. **Not scheduled and not live:** the route is not in `vercel.json`, because the Hobby plan allows only daily crons, which cannot deliver "15 minutes before". **Real delivery is not verified:** no real inbox has received a reminder (needs the Preview mail procedure in [security/account-recovery.md](security/account-recovery.md)). Production migration **not applied**; it must be applied **before** the build that contains it is deployed (see "Production rollout"). Hardened after the pre-release audit: SQL planner, chunked claims under a run budget, a materialized claim CTE, and Resend 409 handling.

Companions: [watchlist-reminders.md](watchlist-reminders.md) (the preference model this builds on), [scheduled-sync.md](scheduled-sync.md) (cron authentication), [security/account-recovery.md](security/account-recovery.md) (the mail foundation and verification).

## Product loop

Discover → Follow → Schedule → Watchlist → **Reminder → (email)** → Watch → History. Phase 6A stored *when* to be reminded and showed it in the app (the header bell). Phase 11 adds one channel, email, for people who opt in.

## Preferences (defined before the schema)

| Preference | Where | Default | Meaning |
|---|---|---|---|
| Per-match offset | `UserWatchlistMatch.reminder` (existing) | `OFF` | when the reminder fires, relative to the start |
| Email channel | `User.reminderEmails` (new) | `false` | email the reminders the user set; in-app display is unaffected |

Rules:

- **Email only to a confirmed address** (`emailVerified`), and only where verification mail is on (`AUTH_EMAIL_VERIFICATION_ENABLED` plus a transport): confirming an address is the first step of opting in (`reminderEmailsAvailable`). The switch refuses to turn on otherwise; turning it off always works.
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
- `FAILED`, with reason `permanent-failure`, `attempts-exhausted` (every attempt answered with a failure) or `mail-disabled`.
- `SKIPPED`, also with reason `provider-already-processed` (Resend holds a request under this key) or `delivery-unconfirmed`. The latter means a row was recovered from an expired lease and cannot be sent again (attempts used up, or no longer eligible), and its last attempt may have been delivered. Neither is a confirmed failure, and neither is resent. Both reuse the existing enum, so no migration is needed.

## Pipeline (lib/notifications/delivery.ts)

Each run goes through four stages:

1. **Plan.** One SQL query computes each row's due instant (start minus its offset, from the same offset table as the UI) and selects only rows that meet all of these:
   - the reminder is due now, within the lateness window;
   - for an offset reminder, the match has not started;
   - the user opted in and is confirmed, and the match is `UPCOMING`;
   - the row is **not yet planned**.

   Rows come earliest-due first, at most 500 per run. Rows that are not due, or already planned, can therefore never fill the limit and push due ones out (tested with a limit of 2). Each row is checked against the eligibility rules again in code, then becomes an intent via `createMany(skipDuplicates)`, which is idempotent under concurrent runs (tested with three at once).
2. **Sweep.** `PENDING`/`RETRY` rows past the lateness window become `SKIPPED(late)`.
3. **Claim**, in chunks under a time budget. `WITH picked AS MATERIALIZED (SELECT … ORDER BY dueAt LIMIT n FOR UPDATE SKIP LOCKED) UPDATE … FROM picked` takes due `PENDING`/`RETRY` rows, and `SENDING` rows whose 5-minute lease expired. It sets `SENDING`, sets a lease and counts the attempt. Concurrent runs claim disjoint rows (tested: four runs at once send exactly one email).
   - **The CTE matters.** The earlier `UPDATE … WHERE id IN (SELECT … LIMIT n …)` form can be re-evaluated by PostgreSQL. Testing caught one statement claiming 2 and 3 rows under a limit of 1, intermittently, which broke the cap.
   - **Chunk size** is `min(10, rows the remaining budget affords, 200 − already claimed)`, then limited by the daily cap.
   - **The daily cap is hard, also across concurrent runs.** For each chunk, one short transaction takes `pg_advisory_xact_lock`, then:
     - counts what the UTC day already used: rows `SENT` today, plus rows `SENDING` claimed today **whatever their lease**, because a stale claim may already have been delivered;
     - claims at most the remaining room.

     A concurrent run waits on the lock and then sees those claims. The lock is never held during a send. Tested with four runs held at a barrier at the cap decision: five due reminders under a cap of 2 → exactly 2 sent. **Without the lock the same test sent 5.**
   - **"Affords"** is `floor(remaining / 12 s)`: 12 s is the worst case of one send, the Resend timeout of 10 s plus database work. The budget is 40 s of the route's 60 s `maxDuration`.

   So even if every send times out, every claimed row finishes before the function limit. Rows not claimed stay `PENDING` with no attempt spent, for the next run (tested). A run that stops on the budget logs `budget-exhausted`.
4. **Send.** First re-check against current data: still watchlisted with the same offset, the same start, still opted in and confirmed, still eligible. Then send with **`idempotencyKey = notification:<id>`**, which goes to Resend as the `Idempotency-Key` header. A retry after an ambiguous failure (a timeout after the provider accepted) therefore reuses the key, and the provider de-duplicates instead of sending twice (tested: every attempt carries the same key). The outcome is written **only if this run still holds the lease** (`WHERE status = SENDING AND leaseUntil = <its lease>`), so a run that stalled past its lease cannot overwrite the run that reclaimed the row (tested).

**Retries.** Only retryable categories retry: timeout, network, rate-limit, provider-5xx and `in-progress`. The backoff is 1, then 2 minutes, with at most **3 attempts** before `FAILED(attempts-exhausted)`. `auth-config`, `provider-4xx` and `invalid-message` fail at once. Within the 15-minute window, nothing retries forever and nothing is sent late.

**Resend 409.** For a 409 only, the transport reads Resend's error `name` and nothing else; the message is dropped.

| `name` | Category | Outcome |
|---|---|---|
| `concurrent_idempotent_requests` / `resource_locked` | `in-progress` (retryable) | `RETRY` with the **same** key. Resend then returns the original outcome, so a send that succeeded ends `SENT`. If attempts run out while still in progress: `SKIPPED(provider-already-processed)`, never `FAILED`. |
| `invalid_idempotent_request` (same key, different payload, for example a renamed team) | `idempotency-conflict` | `SKIPPED(provider-already-processed)`. The earlier request may have been delivered, so it is neither marked `FAILED` nor resent under a new key. |
| an unknown or unreadable 409 | `in-progress` | as above |

All of this is tested in tests/mail/transports.test.ts and tests/db/notification-delivery.test.ts.

**Logs.** One `describeMailResult` line per send, plus `[notifications] run planned=… sent=… …`. Counts only, never an address or content (tested).

## Route and scheduling

`GET /api/cron/notifications` (app/api/cron/notifications/route.ts → lib/api/cron-notifications.ts) works like this, gated by the same rule as the Watchlist offer (`reminderEmailsAvailable`: `AUTH_EMAIL_VERIFICATION_ENABLED` plus a deliverable transport):

- It uses the same `Authorization: Bearer <CRON_SECRET>` check as the sync cron: 503 without a configured secret, 401 when wrong (tested, also over real HTTP).
- When reminder email is not available, it answers `skipped: "reminder-email-unavailable"` without planning or sending anything. That holds **also for users who opted in earlier**, so unsetting the switch stops reminder email for everyone (tested with an opted-in user).
- Its response is counts only, with `cache-control: no-store`.

**Scheduling is a human decision, not done:** reminders need a run every 5 minutes or so. Options:

- **(a)** Vercel Pro, adding `{ "path": "/api/cron/notifications", "schedule": "*/5 * * * *" }` to `vercel.json`;
- **(b)** an external scheduler (GitHub Actions, cron-job.org) calling the route with the secret.

Adding a sub-daily cron on Hobby fails the deployment, so it is not in `vercel.json`. A daily run would skip nearly every reminder as late, by design.

## UI

The Watchlist page has an **Email reminders** card (components/notifications/reminder-email-settings.tsx). It has four states:

- mail unavailable (no transport, or `AUTH_EMAIL_VERIFICATION_ENABLED` off) and not opted in: "Email delivery isn't available on this deployment", with no opt-in;
- opted in but nothing is being sent (mail unavailable, or the address no longer confirmed): "Email reminders are on, but … none are sent", with **Turn off email reminders** only. Opting out never depends on delivery: `reminderSettingsState` decides it, and the server action always accepts turning off;
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
- `tests/api/cron-notifications.test.ts`: authentication before any work, the `reminder-email-unavailable` no-op (no transport, or a transport without `AUTH_EMAIL_VERIFICATION_ENABLED`), the injected clock, a fixed crash message.
- `tests/db/notification-delivery.test.ts`:
  - sends once at the due time, with a link and an idempotency key;
  - idempotent concurrent planning, and exactly-once concurrent delivery;
  - retry with backoff and the same key, bounded attempts;
  - retried success, permanent failure and suppression;
  - lease reclaim with fencing;
  - send-time re-checks: six reasons;
  - no planning for live matches or unconfirmed or opted-out users, and late rows expire;
  - at-start reminders, the daily cap, two-user isolation, the preference rules, metadata-only rows;
  - **the reminder-email switch:** with `AUTH_EMAIL_VERIFICATION_ENABLED` off, a cron invocation sends nothing and plans nothing for an already opted-in user; that user can still opt out, and an opted-out user cannot opt in. With it on, the same invocation delivers as before;
  - **concurrent daily cap:** four runs held at a barrier at the cap decision, five due reminders, cap of 2 → exactly 2 sent, the rest left `PENDING` and unclaimed;
  - **ambiguous outcomes after lease recovery:**
    - a last attempt that may have been delivered, then worker death, lease recovery and attempt exhaustion → `SKIPPED(delivery-unconfirmed)`, never `FAILED`, never resent, the same idempotency key throughout, and the dead worker's late result fenced out;
    - a recovered row that has become too late → also `SKIPPED(delivery-unconfirmed)`;
  - **run time budget:** with an injected clock, only the rows the budget can finish are claimed; the rest stay `PENDING` with no attempt spent and are delivered by the next run;
  - **planner ordering and fairness:** with a plan limit of 2, the earliest-due reminders are planned first, already-planned rows no longer take the limit, and a reminder that is not due is never planned;
  - **Resend 409 in the pipeline:** a payload conflict ends `SKIPPED(provider-already-processed)`, never `FAILED`, never resent. A request still in progress is retried with the same key and ends `SENT`, or ends `provider-already-processed` when attempts run out.
- `tests/mail/transports.test.ts` (409 classification): only Resend's structured error `name` is read. `concurrent_idempotent_requests`, `resource_locked`, and an unknown or unreadable 409 → retryable `in-progress`; `invalid_idempotent_request` → non-retryable `idempotency-conflict`. The provider's message never reaches the result.
- `tests/notifications/policy-and-template.test.ts` also covers the run-budget arithmetic (the worst case covers the 10 s transport timeout and a last chunk still ends before the 60 s `maxDuration`) and the Watchlist card states (opt-out offered whenever a user is opted in, opt-in never offered without delivery).

## Production rollout (human, **not performed**)

**Order is not optional.** The build reads `User.reminderEmails`, and Better Auth's adapter selects every `User` column for each session lookup, so this build on an unmigrated database breaks sign-in. Production deploys on every push to `main`.

1. **Preview first:** run `npm run db:migrate` against the Preview branch database (label `preview`) before using the branch's Preview deployment.
2. **Production migration before merging to `main`:** run `MATCHBASE_OPERATOR_TARGET=production npm run db:migrate` with the Production owner connection. The migration is additive: a new enum, a defaulted column, a new table.
3. **Check:** `npm run production:check -- --env production --db` with the runtime `DATABASE_URL`. Expect:
   - `db-migrations` pass;
   - `db-schema` pass, with `NotificationDelivery` present;
   - `db-table-privileges` pass.

   The runtime role gets the new table through the default privileges from 9.3B only if the migration ran as the owner role that set them. A failure names the table and the missing privileges. Re-run the grant loop of prisma/sql/runtime-role.sql as the owner; the check never grants.
4. Merge and deploy. Mail is live per the account-recovery runbook, including `AUTH_EMAIL_VERIFICATION_ENABLED` (step 8), and has been verified in Preview **with a real reminder**:
   - opt in;
   - set a 5-minute reminder on a match about 7 minutes away;
   - at the due time, call the route with the temporary Preview `CRON_SECRET` and the Deployment Protection bypass header (account-recovery.md, Preview procedure step 6);
   - receive the email exactly once.
5. Choose the scheduling option (a) or (b), set it up, and watch `[notifications] run …` lines for a day. With an external scheduler and a protected Production deployment, the scheduler also needs the bypass header.
6. **Rollback:** remove the schedule. The table and column are inert without it, and opted-in users simply stop receiving email. Instant Rollback to a build from before Phase 11 stays safe after the migration, because the change is additive.
