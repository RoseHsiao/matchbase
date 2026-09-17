# MatchBase: an engineering case study

How a "personal sports and esports command center" forced a rethink of what a match is, and what that rethink made possible.

This document is the narrative version of the decision records in this folder. Each section links the product requirement to the domain problem, the engineering decision, the implementation, and what the user sees. Claims are limited to what is in the repository and covered by tests; the last two sections say what is *not* done.

---

## 1. Problem

A fan who follows an NBA team, a League of Legends roster and two tennis players has three apps, three vocabularies, and no single answer to "what is on tonight that I care about?".

Existing aggregators tend to fail in one of two ways. Either they flatten every discipline into a generic "Team A vs Team B" list, which is wrong for tennis doubles and meaningless for individual players, or they special-case each sport until every page has a `switch (sport)` in it.

MatchBase's product bet is that **following** is the primary action, and that everything a user follows should land in one dashboard, one schedule, one watchlist and one history, regardless of discipline. The engineering bet is that this is achievable with one domain model and one set of UI components.

## 2. Product model

```
Discover → Follow → Schedule → Watchlist → Reminder → Watch → History
```

| Step | Persisted state | Surface |
|---|---|---|
| Discover | catalogue: `Sport → League → Season`, `Team`, `Player`, `Match` | Teams, Players, League detail, Matches |
| Follow | `UserTeamFollow`, `UserPlayerFollow`, `UserLeagueFollow` | follow buttons, "Following" panel |
| Schedule | derived: followed matches by day | Dashboard, Schedule date strip |
| Watchlist | `UserWatchlistMatch` | star on every row, Watchlist page |
| Reminder | `UserWatchlistMatch.reminder` | Match detail, Watchlist, Dashboard, header bell |
| Watch | `Match.status`, scores, `liveDetail` | Match detail |
| History | derived: finished matches | History, team and player results |

The catalogue is shared by the user-facing pages and by an Admin workspace. There are no "admin models"; Admin edits the same rows the dashboard reads. That constraint turned out to matter: it meant every representational shortcut would be visible in both places, and so none was taken.

## 3. Initial domain assumption

The first schema (`20260913083037_init`, 2026-09-13) modelled a match the way most sports schemas do:

```
Match { homeTeamId, awayTeamId, homeScore, awayScore, ... }
```

The decision record at the time ([data-model-architecture-audit.md §6](data-model-architecture-audit.md)) argued for it explicitly. Every consumer was positional, every sport in scope was two-sided, and the only sport-dependent behaviour was *wording*, already handled by a `hasHomeAdvantage(sport)` helper. A generic participant table, the audit said, "buys nothing the product needs" and would cost a join on every list row.

That reasoning was correct for the catalogue at the time: football, basketball, League of Legends, Valorant, Counter-Strike 2. All team-vs-team.

## 4. Why home/away was too restrictive

The assumption broke on the first individual sport. Tennis was on the roadmap because the Sportradar Tennis API was the chosen first live provider (it identifies every player individually, including both members of a doubles pair, which most tennis feeds do not).

| Format | Needs | `homeTeamId / awayTeamId` |
|---|---|---|
| NBA, EPL | one team per side, a home side | works |
| LoL, Valorant, CS2 | one team per side, no home side | works, but "home" is a fiction the UI has to hide |
| Tennis singles | one **player** per side | no team to reference |
| Tennis doubles | **two** players per side | no single participant per side |
| Free agents, independent players | `Player.teamId = null` | player fixtures only reachable through a team |

The tempting shortcut was to invent a `Team` row per player and per pair. The analysis ([match-participant-model-analysis.md §4](match-participant-model-analysis.md)) rejected it because the fake teams would leak everywhere the model is shared: the Teams page, league rosters, Admin, follow suggestions. Worse, a doubles pair would acquire a permanent identity it does not have, since pairings change between tournaments.

So the problem was not presentation. Home/Away wording was already data-driven. The problem was **identity of participation**: the schema could only say "a team took part".

## 5. MatchParticipant redesign

**Decision** ([data-model-decisions.md §6, revised 2026-09-15](data-model-decisions.md)): a match has two sides, `A` and `B`, and each side is a set of participant rows.

```
Match { sideAScore?, sideBScore?, status, startsAt, ... }
  └── MatchParticipant { side: A|B, order: 1..n, teamId? XOR playerId? }
```

Three alternatives were weighed and rejected, each for a specific reason:

- **A `MatchSide` table.** Rejected because nothing a side would store is its own data: `side` is an enum on the participant, the score is a property of the match, "home" is derived from the sport. Revisit triggers were named (more than two sides, per-side data beyond one integer, provider-assigned side ids).
- **Two participant-slot foreign keys on `Match`.** Rejected because the slot entity would need to be persistent and reusable; for doubles it becomes a "pair" record, the fake-team problem under another name.
- **`side = HOME | AWAY`.** Rejected because it is meaningless for half the sports and forces a side table.

**Where the invariants live** was decided as deliberately as the shape:

| Rule | Enforced by |
|---|---|
| Exactly one of `teamId` / `playerId` | database `CHECK MatchParticipant_one_ref` |
| `order >= 1` | database `CHECK MatchParticipant_order_positive` |
| Both scores null or both set | database `CHECK Match_scores_paired` |
| A team or player appears once per match (so never on both sides) | `@@unique([matchId, teamId])`, `@@unique([matchId, playerId])` |
| Unique position within a side | `@@unique([matchId, side, order])` |
| Both sides non-empty; a side is all teams or all players; a team side has exactly one team | `validateParticipants` in `lib/data/match-participants.ts`, shared by the admin form, the sync pipeline and the seed |
| Team participants belong to the match's league | repository |

**Migration** was done in two steps on the same day, with a safety guard instead of the originally planned waiting period:

1. `20260915061141_match_participants`: add the table and the side scores, backfill one participant per legacy team column, copy scores.
2. `20260915063143_drop_legacy_match_sides`: a `DO $$` block re-verifies every legacy side against its participant row and every legacy score against the side scores, raising and rolling back on any mismatch, then drops the four columns.

**Presentation** collapsed into a handful of pure helpers in `lib/matches.ts`: `sideParticipants`, `sideName` ("Hsieh / Ostapenko"), `sideRole` ("Home" / "Away" / nothing), `winnerSide`, `matchTitle`. Components call these; none reads `homeTeamId` because there is none.

**User-facing result.** The same match row, scoreboard and detail page render "Los Angeles Lakers vs Boston Celtics", "T1 vs Gen.G" and "Alcaraz vs Sinner". Doubles shows both portraits overlapped and both names linked to their own player pages. Nothing on those components changed when tennis arrived; only the data did.

## 6. Supporting sports and esports together

Sports and esports are parallel top-level categories, not a special case of one another.

| Concept | Representation | Why |
|---|---|---|
| Category | enum `SPORTS | ESPORTS` on `Sport` | two values, no attributes, only ever derived from a sport |
| Sport / Game | table row **and** a typed code registry (`lib/sports.ts`) | Admin manages status; League and DataSource reference it; it carries behaviour (`homeAway`) |
| League, Season, Team, Player | ordinary rows under a sport | LCK and NBA are the same shape |

The rule that keeps the UI honest is in the registry's own comment: *"Anything that differs between disciplines should be a property here, not a conditional in UI."* Today those properties are `label`, `category` and `homeAway`. Adding tennis was one registry entry (`tennis: { category: "sports", homeAway: false }`) plus a seed row.

The visible effects are consistent everywhere: hierarchy filters (Category → Sport → League), breadcrumbs like "Esports · League of Legends · LCK", one icon component per sport, "Home / Away" labels for football and none for esports or tennis.

Sport ids were kept as the human-readable codes the application already used (`football`, `lol`, `cs2`), so routes, filters and the registry did not need renaming when the table appeared.

## 7. Individual sports and team-less players

`Player.teamId` is nullable. Before the participant model, team-less players were filtered out of user-facing reads because nothing could connect them to a match. After it, they became first-class:

- listed on the Players page and in Admin as "Independent";
- followable like any other player;
- their detail page lists fixtures and results directly through `MatchParticipant.playerId`;
- their league is derived from their most recent match rather than a team.

The seed includes a Wimbledon league with six team-less players in singles and doubles fixtures, which is how the whole path is exercised without a live feed.

## 8. Provider-agnostic external data architecture

The requirement was to ingest real data without letting any provider's shape, or any sport's quirks, into the application. The design has three vocabularies and hard boundaries between them:

```
External API ──▶ Provider adapter ──▶ NormalizedSnapshot ──▶ Sync core ──▶ Sync repository ──▶ PostgreSQL
                 fetch(): Raw          MatchBase vocabulary   generic        upsert by
                 normalize(): pure     external ids           no sport logic (dataSourceId, externalId)
```

| Layer | Knows about | Must not know about |
|---|---|---|
| Adapter | its provider's payload, its sport, MatchBase codes | Prisma, React, other providers |
| Sync core | the `Provider` contract, normalized types, the repository | any sport, any payload, UI |
| Sync repository | Prisma, external identity keys | providers, sports |
| Queries, pages | nothing about sync | provider shapes |

Decisions that follow from the boundaries:

- **External identity is a column pair**, `(dataSourceId, externalId)`, unique on League, Team, Player, Venue and Match, rather than a polymorphic identity table. A hit updates in place, so internal ids, follows, watchlist rows and routes survive re-syncs. Names are never used to match.
- **Each record is written independently** in dependency order. A run is SUCCESS, PARTIAL or FAILED; a malformed record fails alone and is named in the log. There is no run-wide transaction, on purpose: a slow remote fetch inside a long transaction would hold locks, and one bad record should not undo the good ones.
- **Status is the provider's to decide**, mapped to `upcoming | live | finished | unknown`. `unknown` never becomes FINISHED; the stored status is kept and a warning recorded. The UI never infers status from the clock.
- **Two normalized match shapes**: `NormalizedMatch` (home/away team ids, for team sports) and `NormalizedIndividualMatch` (two sides of players). `lib/data/sync/participants.ts` reduces both to participant rows and runs the shared validation. Team adapters were left untouched when player matches were added.
- **The browser never talks to the provider.** Syncs run in a Server Action (Admin "Sync now") or a CLI script; credentials come from server environment variables, travel only in a request header, and are redacted from every recorded message. A scan of the build output confirms no `SPORTRADAR` string reaches the client bundle.
- **HTTP concerns are shared utilities** with injectable `fetch` and `sleep`: timeouts, bounded retries for 429/5xx/timeouts only, `Retry-After` in seconds or HTTP-date form, a rate limiter. Every path is unit-tested without a network.

Two adapters are registered. `mock-basketball` produces deterministic fixtures relative to the run time and exists to drive pipeline, idempotency and PARTIAL-run tests. `sportradar-tennis` walks competitions → seasons → paged season summaries (`X-Max-Results`, a 50-page cap) and normalizes singles and doubles, "Last, First" names, offset timestamps and the full status vocabulary.

Admin → Data Sources reports each source's state without ambiguity: "None (placeholder)", "Mock · Deterministic fixtures, never external data", "Live · Not configured · SPORTRADAR_API_KEY is not set", or "Live · Configured · credentials present, not yet verified against the live API". The three facts (is there a provider, is it configured, has it ever succeeded) are kept apart.

## 9. Watchlist → Reminder product journey

The reminder feature is small in code and instructive in modelling.

**Decision**: a reminder is a property of the user's relationship with a match, so it is a column on the existing join row, `UserWatchlistMatch.reminder`, not a new table. The migration added the enum and the column with a default, so every existing watchlist row became `OFF` with no data touched.

**Rules** are one pure function, `validateReminderChange`, applied by the repository operation and mirrored by the UI, so the control is disabled with the same reason the server would return:

| Situation | Result |
|---|---|
| Reminder on a saved, upcoming match | stored |
| Set `off` | cleared; the match **stays** saved |
| Remove the match from the watchlist | row deleted, reminder goes with it |
| Reminder on a match that is not saved / is live / is finished | rejected with a reason |

**Client state** is optimistic: the toggle updates instantly, the Server Action returns `{ ok, reminder | error }`, and the store rolls back and shows the reason on rejection.

**Surfaces**: Match detail (canonical control with a "Reminder at Today · 7:15 PM" caption), Watchlist (compact control per upcoming row), Dashboard (read-only line), and a header bell that counts upcoming reminders and lists the next five. The bell is where a real notification service would later surface.

**What this is and is not.** The preference is persisted, validated, tested against the database, and shown. No notification is delivered: there is no scheduler, no worker, no push or email. `getReminderAt(startsAt, reminder)` already computes the instant a scheduler would use, and it is pure, so the future work is additive.

## 10. Testing and validation

The test suite is chosen to prove the decisions above rather than to hit a coverage number. All suites use Node's built-in test runner through `tsx`; none touches the network.

| Suite | Proves |
|---|---|
| `tests/domain/match-participants` | every participant rule: both sides, one reference, unique positions, no duplicate competitor, homogeneous sides, one team per team side |
| `tests/domain/matches` | side names for teams, singles and doubles pairs; Home/Away only for sports with home advantage; winner logic |
| `tests/domain/reminders` | every reminder option's instant and label; availability by status; every validation rule |
| `tests/sync/http` | retry policy and classification with injected transport and clock; `Retry-After`; malformed bodies |
| `tests/sync/participants` | both normalized match shapes reduce to the same participant rows |
| `tests/sync/sportradar-tennis` | the adapter end to end against fixtures: configuration failure without a request, 403 handling, pagination, singles and doubles retention, Grand Slam league mapping, statuses, time zones, malformed-record isolation, determinism |
| `tests/db/sync-pipeline` | the real pipeline against PostgreSQL inside rolled-back transactions: idempotency (`created 0, updated n`), PARTIAL runs, sync-log content |
| `tests/db/watchlist-reminders` | reminder persistence and rejection rules against the real database |

The database suites use an injected repository (`createSyncRepository(client)`) and run inside transactions that are always rolled back, so they need a database URL but leave no trace. They skip themselves when no URL is configured.

Alongside the tests: `npm run typecheck`, `npm run lint`, `npm run build` (which also runs `prisma migrate deploy`), and the seed's self-check that its transcribed fixture times still match the mock generator.

## 11. Current limitations

Stated precisely.

- **A second, live-verified provider exists.** TheSportsDB V1 (free key) for Premier League football was synced twice into the development database through the unchanged pipeline; its free tier truncates listings, so it is a window, not a season ([providers/thesportsdb.md](providers/thesportsdb.md)).
- **Live Sportradar responses are unverified.** No API key has been configured in any environment used so far. The adapter, its configuration validation, authentication handling, pagination, normalization, persistence, idempotency and secret redaction are verified against fixtures shaped like the documented API. Actual response shapes, rate-limit behaviour, freshness and catalogue coverage are not. A manual smoke test is documented in [live-data-integration.md §16](live-data-integration.md).
- **Reminders are preferences, not notifications.** Nothing is delivered by any channel.
- **No authentication.** `getCurrentUserId()` returns the seeded demo user for every request. It is the single seam a session would replace; the user tables need no change.
- **Scheduled sync is daily.** A Vercel Cron Job runs the provider-neutral scheduler once a day (the Hobby plan's minimum interval) through the same pipeline as the CLI and Admin, guarded by a database run lock ([scheduled-sync.md](scheduled-sync.md)). No live-score streaming, no deletion reconciliation, and the DataSource → provider binding lives in code rather than a column.
- **Demo data is relative, not live.** The seed lays a fixed timeline of offsets over the current date (or `DEMO_ANCHOR`), evaluated in Asia/Taipei, and refuses any anchor for which statuses and times would contradict. Nothing advances between seeds; a "live" match is an authored fixture. See [demo-data-and-time.md](demo-data-and-time.md).
- **Presentation time zone.** Instants are stored in UTC and reminder arithmetic is zone-free, but day boundaries still use the server's local zone; the decided Asia/Taipei rule is not applied.
- **Monitoring is visibility only.** Admin → Monitoring derives per-source health from sync logs and readiness ([operational-monitoring.md](operational-monitoring.md)); nothing alerts anyone.
- **Schema gaps known and accepted.** No partial unique index for "one CURRENT season per league" (repository-enforced). No per-set or per-map scores, rankings or seeds. Admin Analytics, Monitoring and Settings are placeholders.

## 12. What comes next

In rough priority order; none is started.

1. Run the live Sportradar smoke test with a real key; record observed shapes; fix adapter assumptions.
2. Authentication behind `getCurrentUserId()`.
3. Reminder delivery: a scheduler over `UserWatchlistMatch × Match.startsAt`, an idempotent delivery log, and in-app delivery through the existing header bell first.
4. Scheduled synchronization and a `DataSource.provider` column.
5. Apply the presentation time zone to day boundaries.
6. A second team-sport live provider to test the "one adapter file, one registry entry, one DataSource row" claim against a real feed.

---

Decision records: [data-model-decisions.md](data-model-decisions.md) · [match-participant-model-analysis.md](match-participant-model-analysis.md) · [external-data-sync-architecture.md](external-data-sync-architecture.md) · [live-data-integration.md](live-data-integration.md) · [tennis-provider.md](tennis-provider.md) · [watchlist-reminders.md](watchlist-reminders.md). Index: [README.md](README.md).
