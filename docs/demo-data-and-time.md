# Demo data and time (Phase 8.2)

Status: implemented 2026-09-17. The seeded demo lays a fixed *timeline of offsets* over the current date, so the portfolio stays populated as the calendar moves, while every test and every provider fixture keeps a fixed instant. No live data is involved; relative demo data is still demo data.

## Why the fixed seed aged out

Until this phase the seed pinned every demo timestamp to one instant, 2026-09-14 12:00 Asia/Taipei. That made re-seeding deterministic, but the fixtures only spanned about a week around that date. After it, "Today" on the Dashboard emptied, every match slid into the past while its stored status still said UPCOMING or LIVE, reminders pointed at instants that had already passed, and screenshots stopped showing the product journey. Moving the constant by hand every few days is not a strategy.

## Two kinds of time

| Kind | Examples | Anchor | Ever reads the wall clock? |
|---|---|---|---|
| **Deterministic test data** | Sportradar fixtures (`tests/sync/fixtures`), provider tests, the database pipeline test, participant and reminder unit tests | fixed instants in the fixture (`NOW = 2026-07-05T12:00Z`) or in the test | never |
| **Time-relative demo data** | the 23 seeded matches, DataSource `lastSyncedAt`, SyncLog `startedAt`, admin activity | the demo clock anchor | only the seed, once, to choose the anchor |
| **Real provider data** | anything with `dataSourceId` and `externalId`, such as rows written by the mock basketball or Sportradar sync | the provider's own timestamps | never shifted by anything in this phase |
| **Presentation** | "Today", "Tomorrow", the schedule window, fixture grace periods | the request's `now`, computed once per page on the server | yes, by design |

## Strategies considered

- **A. Fixed historical snapshot.** Keep 2026-09-14 forever. Deterministic, but the demo is dead from the second week on and the status columns contradict the dates.
- **B. Fully relative timestamps.** Evaluate every timestamp from `Date.now()` wherever it is read. Populated, but tests become clock-dependent, the seed cannot be reproduced, and the same pattern would tempt provider code to do the same.
- **C. Hybrid (chosen).** The mock file stays a deterministic *template*: matches are described by offsets ("67 minutes before the anchor", "tomorrow at 21:00 Taipei") and authored statuses. One injectable clock turns offsets into instants. The seed resolves its anchor from the real date; tests pass a fixed anchor. This is the smallest change that keeps every requirement: the mock file already used offsets, so the work was to make the anchor a parameter instead of import time or a constant.

## The demo clock

`lib/demo-clock.ts` exports:

```ts
createDemoClock({ anchor: Date, timeZone?: string }): DemoClock
// DemoClock = { anchor, timeZone, fromAnchor(minutes), at(dayOffset, hour, minute?), anchorDate() }
resolveDemoAnchor(env, now): Date
DEMO_TIME_ZONE = "Asia/Taipei"
```

- `fromAnchor(m)` is anchor plus `m` minutes: used for today's finished, live and upcoming matches so their distance from "now" is exact.
- `at(d, h, mm)` is `d` calendar days from the anchor's day in the demo zone, at that wall-clock time: used for tomorrow, later this week, and recent history so kick-offs read as real evening fixtures. Day arithmetic goes through `Date.UTC`, so month and year boundaries and leap days are handled by the platform.
- A clock is a frozen plain object. There is no global clock, no mutable singleton, and `Date` is never patched. Rendering never uses a clock; pages keep computing `now` per request as before.

`lib/data/mock.ts` exposes the timeline as builders, `buildMatches(clock)`, `buildDataSources(clock)`, `buildSyncLogs(clock)`, `buildAdminActivity(clock)`, and `buildDemoData(clock)` for all four. The static catalogue (leagues, teams, players, seasons, venues) and the demo user's follows are plain exports and carry no time. The module-level `matches` and friends are one evaluation at import for consumers that only need a representative snapshot; the seed builds its own.

## Anchor resolution

`prisma/seed.ts` calls `resolveDemoAnchor(process.env, new Date())`:

| `DEMO_ANCHOR` | Anchor |
|---|---|
| unset | the current instant floored to the previous half hour, so seeded kick-offs land on :00 and :30 |
| `2026-09-14` | that day at 12:00 Asia/Taipei (the original fixed seed) |
| `2026-09-14T19:30` | that wall-clock time in Asia/Taipei |
| `2026-09-14T04:00:00Z`, `…+08:00` | that exact instant |
| anything else | the seed refuses to run rather than guess |

The seed prints the anchor it used, both as an instant and as a Taipei date. To reproduce a demo state for debugging, seed with `DEMO_ANCHOR=2026-09-14 npm run db:seed`.

## Time zone

Day-relative offsets are interpreted in `Asia/Taipei`, the presentation zone the product was designed around (decisions §12). The conversion is explicit: `zonedToInstant` and `instantToZoned` use `Intl.DateTimeFormat` with the named zone, so the seeding machine's zone never leaks in, and the same code is correct for zones with daylight saving time (tested against Europe/Berlin and America/New_York). No date library was added.

What this phase did **not** change was the application's own day boundaries: `startOfDay`, `dayKey` and the schedule window used the server's local zone, so "Today" was a Taipei day on a Taipei machine and a UTC day on a UTC host.

**Resolved in Phase 9.4 (2026-10-13).** That debt became a Production defect: the server rendered UTC times and the browser re-rendered local ones, which React reported as hydration error #418. The zone literal now lives once in `lib/time-zone.ts` as `PRESENTATION_TIME_ZONE`, `DEMO_TIME_ZONE` is an alias of it, and `lib/format.ts` pins the zone on every formatter and every day boundary. "Today", day grouping and the schedule window are the Taipei calendar day for every visitor, and server and client render identical text.

## What the timeline contains

For any anchor, relative to the anchor's Taipei day:

| When | Matches | Status |
|---|---|---|
| Today, earlier | LEC G2 vs Fnatic, ESL NaVi vs FaZe | finished, with scores |
| Today, now | EPL Arsenal vs Chelsea (67'), VCT Sentinels vs Paper Rex (Map 3) | live |
| Today, later | EPL Liverpool vs Man City, LCK T1 vs Gen.G, ESL Vitality vs Spirit, NBA Lakers vs Celtics | upcoming |
| Tomorrow | UCL Real Madrid vs Bayern, LEC KC vs MAD, NBA Warriors vs Nuggets, LCK HLE vs DK | upcoming |
| Days 2 to 6 | VCT, EPL, ESL, LEC, LCK fixtures, Wimbledon doubles final, a tennis exhibition | upcoming |
| Yesterday and the day before | LCK T1 vs HLE, EPL Man City vs Spurs, NBA Celtics vs Warriors, Wimbledon Alcaraz vs Sinner | finished, with scores |

Domains covered: football, basketball, tennis singles and doubles, League of Legends, Valorant, Counter-Strike 2. Tennis matches are player participants only; no team is ever invented.

The demo user's watchlist holds seven matches. Four upcoming ones carry a reminder (15 min, 1 hour, at start, 1 day before), the other upcoming one has none, and two are already live or finished so the "cannot set a reminder" states are visible too.

## Status and time consistency

Statuses are authored in the timeline, never derived from the clock, exactly as they are for real provider data. `lib/data/demo-consistency.ts` checks, for the anchor in use, that:

- an upcoming match starts after the anchor and has no score;
- a live match started at or before the anchor and within six hours of it;
- a finished match started before the anchor, has a score, and carries no live detail;
- every reminder sits on a watchlisted, upcoming match and would fire after the anchor and no later than the match.

The seed runs this check and refuses to write an incoherent set. The unit tests run it for several anchors, including odd times of day, a leap day, and year ends.

## Identity and idempotency

Ids are fixed slugs (`m-epl-liv-mci`, `lakers`, `alcaraz`) and are never derived from time. Every row is upserted by id; participants are reconciled by `(matchId, side, order)` so their ids survive re-seeds; follows and watchlist rows are upserted by their composite keys. Re-seeding on another day therefore changes only the demo timestamps. Rows owned by a provider (`dataSourceId` set) are never touched, because the seed only ever addresses its own ids. Verified against the development database by seeding twice and diffing full snapshots.

## What is never shifted

- Provider fixtures under `tests/sync/fixtures` and every assertion on them.
- Rows written by a sync run, including the mock basketball provider's matches (its fixtures are relative to the sync's own `now`, which the pipeline receives as an argument).
- Season windows, which are calendar dates of the catalogue.
- Anything in `lib/data/sync`; normalization takes provider instants as they are.

## Tests

- `tests/domain/demo-clock.test.ts`: fixed anchor values, calendar day in the demo zone, month, year and leap-day boundaries, explicit zone behaviour in three zones, DST conversion, `DEMO_ANCHOR` forms and rejections.
- `tests/domain/demo-data.test.ts`: coherence for several anchors, future and past invariants, journey coverage, reminder timing, identical output for the same anchor, unchanged ids and statuses for a different anchor, no fake tennis teams, and that the checker catches contradictions.

None of them reads the wall clock.

## Limitations

- ~~Presentation day boundaries still follow the server's zone~~ — resolved in Phase 9.4; they follow `PRESENTATION_TIME_ZONE`.
- The seed anchor is the seed *moment*: a demo seeded on Monday shows Monday's "today" until it is seeded again. Re-seeding is the refresh; nothing runs on a schedule by design.
- Season windows in the catalogue are fixed 2026 and 2027 dates and do not move with the anchor.
- "Live" matches are authored fixtures with a fixed minute; no clock advances them.
