# Watchlist reminders (Phase 6A)

Status: implemented 2026-09-15. Reminder *preferences* are stored and shown. **Update 2026-10-28 (Phase 11):** email delivery of these reminders is implemented for users who opt in. See [notifications.md](notifications.md); the "Future architecture" section below is kept as written.

## Product loop

Follow → Schedule → Watchlist → Reminder. A user finds a match, saves it, chooses when to be reminded, and sees that choice on the match page, the Watchlist, the Dashboard, and the header bell.

## Model

The reminder is a property of the user's watchlist relationship with a match, so it lives on the existing row rather than in a new table:

```prisma
enum WatchlistReminder { OFF AT_START MIN_5 MIN_15 MIN_30 HOUR_1 DAY_1 }

model UserWatchlistMatch {
  userId    String
  matchId   String
  reminder  WatchlistReminder @default(OFF)
  createdAt DateTime
}
```

Migration `20260915084918_watchlist_reminders` adds the enum and the column with a default, so every existing watchlist row became `OFF` and no data was touched. No table for notification history, deliveries, push subscriptions or scheduling exists; none is needed to store a preference.

Domain type (`lib/data/types.ts`): `WatchlistReminder = "off" | "at_start" | "5m" | "15m" | "30m" | "1h" | "1d"`. `UserFollows.watchlistReminders` maps saved match ids to their reminder; `WatchlistEntryView` adds the match facts the shell needs (title, start, status, league, sport).

## Behaviour

| Situation | Result |
|---|---|
| Set a reminder on a saved upcoming match | Stored; shown everywhere the match appears |
| Set `off` | Reminder cleared; the match **stays** on the watchlist |
| Remove the match from the watchlist | The row is deleted, so the reminder goes with it; saving again starts from `off` |
| Set a reminder on a match that is not saved | Rejected: "Add the match to your watchlist before setting a reminder." (`off` is a harmless no-op) |
| Set a reminder on a live match | Rejected: "This match has already started." |
| Set a reminder on a finished match | Rejected: "This match has already finished." |
| Unknown value, user, or match | Rejected with a clear message |

The rules are one pure function, `validateReminderChange` in `lib/watchlist/reminder-rules.ts`, applied by the repository operation (`lib/data/repositories/watchlist-reminder-ops.ts`) and mirrored by the UI (the control is disabled with the same reason). The server action `setWatchlistReminder(matchId, reminder)` in `lib/data/user-state-actions.ts` returns `{ ok, reminder | error }` so the client can roll back its optimistic value and show the reason. `setMatchWatchlisted` is unchanged: saving keeps an existing reminder, removing deletes the row.

## Time

`getReminderAt(matchStart, reminder)` in `lib/reminders.ts` returns `null` for `off`, the start instant for `at_start`, and `start − offset` otherwise. It is pure arithmetic on the absolute instant; no time zone is involved, so "15 minutes before 19:30" is 19:15 in whatever zone the start is displayed. Formatting uses the existing helpers in `lib/format.ts`.

## UI

- **Match Detail** (canonical place): under the watchlist button, a compact `Reminder [Off ▼]` select with a caption ("Reminder at Today · 7:15 PM", or the reason it is unavailable). Disabled unless the match is saved and upcoming.
- **Watchlist page**: each upcoming row has the same select in its compact form next to the star; the summary line counts matches with a reminder.
- **Dashboard → Watchlist panel**: a read-only "🔔 15 min before · 7:15 PM" line under the status.
- **Header bell** (`components/reminders/reminder-indicator.tsx`): a count of upcoming saved matches with a reminder and a popover listing the next five, linking to each match and to the Watchlist. This is the surface a real notification service would later populate.
- Schedule and Matches keep the star only; the reminder is configured on Match Detail or the Watchlist so the lists stay uncluttered.

Client state: `WatchlistRemindersProvider` (`components/watchlist/watchlist-reminders-provider.tsx`) is a small store layered on the existing watchlist id store, seeded by the layout from `getWatchlistEntries()` and re-synced after every server action. It is not a second watchlist: membership still comes from the id store; this store only holds the per-match preference.

## Seed

`lib/data/mock.ts` gives the demo user one saved match per state: `m-epl-liv-mci` → 15 min, `m-ucl-rma-fcb` → 1 hour, `m-lec-g2-kc` → at start, `m-esl-faze-vit` → 1 day, and the rest off. The seed resets these demo rows to those values on every run (idempotent, no dependence on the clock); other rows the user saved at runtime are untouched.

## Tests

- `tests/domain/reminders.test.ts`: every option's instant, labels, availability by status, and every validation rule.
- `tests/db/watchlist-reminders.test.ts`: persistence against the real database inside rolled-back transactions (set, update, `off` keeps the row, removal drops the reminder, non-watchlisted / live / finished rejections, unknown ids). Skipped when no database URL is configured.

## Future architecture (not implemented)

```
Watchlist reminder (this phase)
        ↓
reminderAt = startsAt − offset        ← lib/reminders.ts, already pure and testable
        ↓
Scheduler / background worker         ← finds rows whose reminderAt is due and not yet sent
        ↓
Notification service                  ← per-user channels, deduplication, delivery log
        ↓
Web Push / e-mail / mobile push
```

Delivery is deferred on purpose: the app has a single demo user and no authentication, no background execution (no scheduler, cron, or worker), and no push or e-mail infrastructure. Adding delivery later means a worker that queries `UserWatchlistMatch` joined with `Match.startsAt`, a delivery log table to make sends idempotent, and per-user channel subscriptions. None of that changes the preference model built here, and the header bell is where in-app delivery would surface.
