# Match / MatchSide / MatchParticipant Analysis

Phase 5 (2026-09-15). Sections 1 to 25 are the analysis as written before implementation; nothing was changed while producing them. The model was implemented the same day, and section 26 ("Implementation") records what was built and where it deviates from the recommendation (notably: `Sport.participantKind` / `maxPerSide` were **not** added, scores are `sideAScore` / `sideBScore`, participant indexes are single-column). Read section 26 as authoritative and the rest as the reasoning behind it.

## 1. Executive Summary

The current `Match` row stores exactly two `Team` references (`homeTeamId`, `awayTeamId`) and two aggregate scores. That is the right shape for every sport MatchBase holds today (basketball, football, League of Legends, Valorant, Counter-Strike 2: 28 matches, all team-vs-team) and for volleyball. It cannot represent tennis, table tennis, or badminton without inventing fake `Team` rows for players and pairs, which Phase 4 explicitly refuses to do.

Recommendation: replace the two team columns with a **`MatchParticipant` table that carries a `side` enum (`A` | `B`)**, keep the two aggregate scores on `Match` (renamed to side A / side B), and keep Home/Away as the existing sport-level presentation flag. **Do not add a `MatchSide` table.** With every target sport having exactly two sides and no side-level data beyond one score, a side is an attribute of a participant, not an entity. A side table would add a join to every match read and a second set of identities to keep in sync, in exchange for flexibility (N sides, per-side metadata) that no planned sport needs.

The change is a genuine data-model cutover: 21 runtime files reference the current fields, and the two columns underpin every "matches involving team X" query and both team indexes. It is worth doing only when an individual sport is actually being added. Until then the current model is correct and should stay. The recommended sequencing is one migration that adds the table and backfills two rows per existing match, a code cutover to read participants, and a second migration that drops the old columns after one release. Confidence in the need is high; confidence in "participant enum, no side table" is medium-high, with the trigger for revisiting stated in section 10.

## 2. Current Match Model Audit

From `prisma/schema.prisma` (unchanged since Phase 3):

```
Match
  id            String  @id @default(cuid())
  leagueId      String  → League   (Restrict)
  seasonId      String  → Season   (Restrict)
  homeTeamId    String  → Team     (Restrict, relation "HomeTeam")
  awayTeamId    String  → Team     (Restrict, relation "AwayTeam")
  venueId       String? → Venue    (SetNull)
  startsAt      timestamptz
  status        UPCOMING | LIVE | FINISHED
  stage         String?
  homeScore     Int?     -- both null or both set (repository rule)
  awayScore     Int?
  liveDetail    String?
  dataSourceId  String? → DataSource (SetNull)
  externalId    String?
  @@unique([dataSourceId, externalId])
  @@index([homeTeamId, startsAt]), @@index([awayTeamId, startsAt]), …
```

Domain (`lib/data/types.ts`): `Match` mirrors the row with `score?: { home, away }`; `MatchView` adds `league`, `homeTeam`, `awayTeam` objects. `Sport.homeAway` (database) and `sportMeta[sport].homeAway` (registry) say whether the two slots mean Home/Away or first/second side. Decisions §6 states the positional convention explicitly: for esports, "home" is the first-listed side.

Database shape today:

| Sport | `homeAway` | Matches | Provider-synced | With scores |
|---|---|---|---|---|
| basketball | true | 11 | 8 | 4 |
| football | true | 5 | 0 | 2 |
| lol | false | 7 | 0 | 2 |
| valorant | false | 2 | 0 | 1 |
| cs2 | false | 3 | 0 | 1 |

All 28 are team-vs-team. Seven watchlist rows reference matches by id only.

## 3. Current Code Coupling Audit

Repository-wide reference counts, excluding the generated Prisma client:

| Symbol | References | Symbol | References |
|---|---|---|---|
| `homeTeamId` | 63 | `homeTeam` (joined object) | 15 |
| `awayTeamId` | 60 | `awayTeam` (joined object) | 15 |
| `homeScore` | 27 | `homeAway` | 12 |
| `awayScore` | 27 | `hasHomeAdvantage` | 8 |
| `score.home` | 6 | `score.away` | 6 |

By file (21 files; the first is seed input only):

| File | Refs | Role |
|---|---|---|
| `lib/data/mock.ts` | 40 | Seed source only; not runtime |
| `components/admin/views/admin-matches-view.tsx` | 27 | Admin form: two team selects, two score fields, Home/Away labels |
| `lib/data/repositories/admin-repository.ts` | 13 | Validation (distinct teams, paired scores, teams in league), upsert |
| `prisma/schema.prisma` | 12 | Columns, relations, indexes |
| `lib/data/sync/sync-service.ts` | 11 | Resolves home/away external ids, writes scores |
| `lib/schedule.ts` | 9 | Team filter (`homeTeamId === id || awayTeamId === id`), search over both team names |
| `lib/sports.ts` | 8 | `homeAway` registry flag, `hasHomeAdvantage()` |
| `lib/data/repositories/mappers.ts` | 8 | `toMatch` / `toMatchView` |
| `components/matches/match-scoreboard.tsx` | 8 | Two team blocks, "Home"/"Away" role labels, winner emphasis |
| `prisma/seed.ts` | 5 | Seed mapping |
| `components/teams/team-row.tsx` | 5 | Opponent lookup, "at" vs "vs" wording |
| `lib/data/types.ts` | 4 | `Match`, `MatchScore`, `MatchView` |
| `lib/data/repositories/sync-repository.ts` | 4 | Upsert data shape |
| `components/matches/match-row.tsx` | 4 | Two team lines, winner emphasis |
| `lib/data/sync/types.ts` | 2 | `NormalizedMatch` |
| `lib/data/sync/providers/mock-basketball.ts` | 2 | Adapter mapping |
| `app/(app)/matches/[id]/page.tsx` | 2 | Title "X vs Y" |
| `lib/data/repositories/team-repository.ts` | 1 | Next-match-per-team |
| `lib/data/repositories/match-repository.ts` | 1 | `involvesAny`: `OR [homeTeamId in, awayTeamId in]` |
| `components/teams/followed-teams-stat-card.tsx` | 1 | "playing today" |
| `components/history/history-view.tsx` | 1 | Search over both teams |

What the coupling actually is:

- **Identity of participation** (the deep coupling): every "matches involving team X" path is `homeTeamId = X OR awayTeamId = X`, in `match-repository.ts`, `schedule.ts`, `team-row.tsx`, `followed-teams-stat-card.tsx`. Two indexes exist purely for it.
- **Rendering**: components render exactly two `Team` objects positionally and compute the winner by comparing two numbers. The Home/Away wording is already isolated behind `hasHomeAdvantage(sport)`; nothing in the UI hardcodes a league.
- **Writes**: admin validation and sync both assume two teams and two scores.
- **Not coupled**: match status, watchlist, follows, venue, season, league, the schedule day grouping, the history date filter, the hierarchy filters (category, sport, league), and every page that does not render a match row.

The Home/Away *presentation* is already data-driven and cleanly separated. The *participation* model is what a generalised model must replace.

## 4. Domain Problem

A side is the unit that wins or loses: a team, one player, or a pair. The current row can name a side only as a `Team`. The sports below need sides that are players or pairs, and forcing them into `Team` rows would corrupt the catalogue (fake teams appear on the Teams page, in league rosters, in Admin, in follow suggestions) and would give doubles pairs a permanent identity they do not have (pairings change between tournaments).

## 5. Sport Coverage Matrix

Current project sport codes are `football`, `basketball`, `lol`, `valorant`, `cs2`. Future codes are illustrative.

| Sport (code) | Competition example | Participant per side | Sides | Current Match works? | Future model |
|---|---|---|---|---|---|
| Basketball (`basketball`) | NBA, Mock Basketball League | 1 Team | 2 | Yes | Side A/B each one team participant; A = Home |
| Football (`football`) | EPL, UCL | 1 Team | 2 | Yes | Same; A = Home |
| Volleyball (`volleyball`, future) | VNL | 1 Team | 2 | Yes | Same; A = Home; aggregate score = sets |
| League of Legends (`lol`) | LCK, LEC | 1 Team | 2 | Yes | Same; no Home/Away label (`homeAway=false`) |
| Valorant (`valorant`) | VCT | 1 Team | 2 | Yes | Same |
| Counter-Strike 2 (`cs2`) | ESL Pro League | 1 Team | 2 | Yes | Same; aggregate = maps |
| Tennis singles (`tennis`, future) | ATP / WTA | 1 Player | 2 | No | Side A/B each one player participant; aggregate = sets |
| Tennis doubles | ATP / WTA | 2 Players | 2 | No | Side A/B each two player participants (order 1, 2) |
| Table tennis singles (`tabletennis`, future) | WTT | 1 Player | 2 | No | As tennis singles; aggregate = games |
| Table tennis doubles / team | WTT, ITTF team events | 2 Players, or 1 Team | 2 | No / Yes | Players per side, or team per side for team events |
| Badminton singles (`badminton`, future) | BWF | 1 Player | 2 | No | As tennis singles; aggregate = games |
| Badminton doubles | BWF | 2 Players | 2 | No | Two player participants per side |
| Future team competition | e.g. national team ties | 1 Team (+ roster) | 2 | Yes | Team participant per side; roster detail deferred |

Every row has exactly two sides. That fact drives the recommendation.

## 6. Option A: Current Home/Away Model

`Match.homeTeamId / awayTeamId / homeScore / awayScore`.

- Basketball, football, volleyball, LoL, Valorant, CS2: correct and simple. Two FK columns give the cheapest possible participation query and integrity (`NOT NULL`, `Restrict`).
- Tennis, table tennis, badminton: impossible without fake teams. Phase 4 adapters must drop those fixtures with a warning, which is what the sync architecture document specifies.
- Schema, query, UI, sync complexity: lowest.
- Extensibility: none for individual sports.
- Migration difficulty: zero (it is the status quo).

Verdict: right for today's data; a hard wall for the target sports.

## 7. Option B: Two Participant Slots on Match

`Match.homeParticipantId / awayParticipantId` pointing at a new participant entity that is a team *or* a player.

This keeps two columns on `Match` (so participation queries stay simple) but needs the participant entity to be a persistent, reusable thing. For a team or a single player that entity is redundant with `Team` / `Player`. For doubles it becomes a persistent "pair" record, which is exactly the fake-team problem under a different name: pairs would need identity, naming, and lifecycle management for something that exists only for one match. Rejected.

## 8. Option C: `MatchParticipant` Rows with a `side` Attribute

`Match` keeps its scalar columns and aggregate scores; a new `MatchParticipant` table holds one row per competitor with `side` (`A` | `B`), an optional `teamId`, an optional `playerId`, and `order`.

- Basketball / football / volleyball / esports: two rows per match (`A: team`, `B: team`). Home/Away wording unchanged via `Sport.homeAway` with side A = home.
- Tennis singles: two rows (`A: player`, `B: player`).
- Doubles: four rows (`A: player order 1`, `A: player order 2`, `B: …`). The pair is the set of rows sharing `(matchId, side)`; nothing permanent is created.
- Team events with rosters: team rows now; roster rows later if ever needed (deferred).
- Schema: one new table, one enum. Query: participation becomes a relation filter (`participants: { some: { teamId } }`), one join for reads. UI: components iterate two side groups. Sync: `NormalizedMatch.sides`. Migration: backfill two rows per existing match.

Verdict: represents every target sport with one table and no fake entities.

## 9. Option D: `MatchSide` Table plus `MatchParticipant`

`MatchSide(matchId, side, score?, …)` with `MatchParticipant(sideId, teamId?, playerId?, order)`.

Adds to Option C: sides as rows (so N sides are possible), a natural home for per-side data (score, seed, a provider's side id, a "neutral" flag), and a real FK from participant to side instead of an enum.

Costs: two new tables; every match read joins match → sides → participants → team/player; aggregate scores move off `Match` into side rows, so "winner" needs the two side rows loaded; sync must reconcile side rows as well as participant rows; the admin form and every component must group by side entity rather than enum. None of the target sports has more than two sides or side-level data beyond one score.

Verdict: strictly more general than needed. Reasonable if a third side or per-side metadata appears; premature now.

## 10. Do We Need MatchSide?

No, not for the sports in scope. The test is whether a side carries data of its own that is not a property of the match or of a participant:

| Candidate side field | Where it belongs instead |
|---|---|
| `side` (A/B) | Enum on the participant; the pair is the set of participants sharing it |
| `score` | Two aggregate columns on `Match` (side A, side B), exactly as today |
| `homeAway` / label | Derived: `Sport.homeAway && side === "A"`; never stored per match |
| `seed`, `ranking` | Not a requirement; would attach to the participant if ever needed |
| provider side id | Providers identify matches and competitors, not sides; nothing to store |

Everything a `MatchSide` row would hold is either already on `Match` or derivable. The grouping value it offers (doubles pairs) is fully captured by the `side` enum plus `order`. The two-table design pays a permanent join and reconciliation cost for optionality. Revisit if any of these becomes a requirement: more than two sides per match (battle royale, multi-team relays), per-side data that is not a single integer score, or a provider that assigns stable ids to sides.

## 11. Recommended Domain Model

```
Match
  id, leagueId, seasonId, venueId?, startsAt, status, stage?, liveDetail?,
  scoreA?, scoreB?            (aggregate result per side; both null or both set)
  dataSourceId?, externalId?

MatchParticipant
  id, matchId, side (A | B), order (1..n), teamId? XOR playerId?

Sport (existing)
  homeAway                    (side A is Home when true; unchanged)
  + participantKind: TEAM | PLAYER   (what a side is made of in this sport)
  + maxPerSide: Int                  (1 for singles/team sports, 2 where doubles exist)
```

Domain types (`lib/data/types.ts`) after the change:

```ts
type MatchSideView = {
  side: "A" | "B"
  /** True only when the sport has home advantage and this is side A. */
  isHome: boolean
  participants: Array<{ order: number; team?: Team; player?: Player }>
  score?: number
}
type MatchView = Match & { league: League; sides: [MatchSideView, MatchSideView] }
```

`Match.score` stays an aggregate pair. The two new `Sport` fields are what make the admin form and validation data-driven (which selector to show, how many per side) without any league or sport name in code. The five current sports are `TEAM` / 1.

## 12. Recommended Prisma Model

Conceptual, not to be applied in this phase:

```
enum MatchSideKey { A B }
enum ParticipantKind { TEAM PLAYER }

model Sport {
  ...existing
  participantKind ParticipantKind @default(TEAM)
  maxPerSide      Int             @default(1)
}

model Match {
  ...existing minus homeTeamId / awayTeamId / homeScore / awayScore
  scoreA Int?
  scoreB Int?
  participants MatchParticipant[]
}

model MatchParticipant {
  id       String       @id @default(cuid())
  matchId  String
  side     MatchSideKey
  order    Int          @default(1)
  teamId   String?
  playerId String?

  match  Match   @relation(fields: [matchId], references: [id], onDelete: Cascade)
  team   Team?   @relation(fields: [teamId], references: [id], onDelete: Restrict)
  player Player? @relation(fields: [playerId], references: [id], onDelete: Restrict)

  @@unique([matchId, side, order])
  @@unique([matchId, teamId])
  @@unique([matchId, playerId])
  @@index([teamId, matchId])
  @@index([playerId, matchId])
}
```

Required: `matchId`, `side`, `order`, exactly one of `teamId` / `playerId`. Optional: nothing else. Not included: `participantType` (derivable from which FK is set), `seed`, `captain`, `scoreContribution`, `label`, external ids.

Relations: `Team.participations MatchParticipant[]` and `Player.participations MatchParticipant[]` replace `Team.homeMatches` / `awayMatches`. The `Match` indexes `(homeTeamId, startsAt)` and `(awayTeamId, startsAt)` are replaced by the participant indexes above; "team fixtures ordered by time" becomes an index-backed join.

## 13. Score Model

Keep two aggregate integers on `Match`, one per side. "Aggregate" means the match result in the sport's natural unit, decided by the adapter or the admin: points for basketball and football, sets for tennis and volleyball, games for badminton and table tennis, maps for Counter-Strike and Valorant, games in a series for League of Legends. The winner is still "the larger of the two", so `match-row.tsx` and `match-scoreboard.tsx` keep their logic with a rename.

Set, game, map, and period breakdowns are a future `MatchPeriod` child table (decisions §6 already anticipates it). Nothing in the participant model depends on it.

Renaming `homeScore` / `awayScore` to `scoreA` / `scoreB` is recommended but not required: keeping the names with documented "side A / side B" semantics avoids 54 edits; renaming avoids permanent confusion in esports and individual sports. The migration must touch these columns' consumers anyway, so the rename is cheap at that moment.

## 14. Home/Away Model

Keep the existing approach: `Sport.homeAway` (persisted) mirrored in `lib/sports.ts`, with the fixed convention **side A is the home side when the sport has home advantage**. This is already how the app behaves ("home" is first-listed for esports, decisions §6).

Rejected alternatives: `MatchSide.side = HOME | AWAY` (meaningless for half the sports and forces a side table); a per-match `homeSideId` (a second source of truth for a fact that is a property of the sport, and every current match already follows the convention); league or provider-level flags (no current need; a provider adapter simply orders sides so that its home side is A). If a sport ever needs per-match neutral-venue handling, a nullable boolean on `Match` (not on the side) would be the smallest addition.

## 15. External ID Strategy

No external ids on `MatchParticipant`. Providers identify matches (`Match.externalId`), teams (`Team.externalId`), and players (`Player.externalId`); a participant is fully identified by `(matchId, side, teamId | playerId)`, all of which resolve through those existing external identities. Adding provider ids to participants would duplicate `(dataSourceId, externalId)` on a row that has no provider-side identity of its own. Sync idempotency for participants is therefore set reconciliation per match (section 18), not upsert by external key.

## 16. Constraints

Justified:

- `unique(matchId, side, order)`: one competitor per position within a side; `order` is meaningful for doubles display and stable reconciliation.
- `unique(matchId, teamId)` and `unique(matchId, playerId)`: a team or player appears once per match, which also prevents the same competitor on both sides. PostgreSQL treats nulls as distinct, so the unique on the nullable column only bites when set.
- Repository rules (Prisma cannot express them; CHECK constraints possible later): exactly one of `teamId` / `playerId` is set; every participant on a side has the same kind; each side has between 1 and `Sport.maxPerSide` participants and the kind matches `Sport.participantKind`; both sides are present before a match is `LIVE` or `FINISHED`; scores both null or both set.

Answers to the specific questions: one side can contain multiple players (doubles); a side must not mix a team and players (kind rule above; rosters are a future concern); the same player cannot appear twice (unique); a player cannot be on both sides (same unique); a team and its players are never both participants (kind rule); order is unique within a side.

## 17. Delete Semantics

- Match deleted → participants cascade (they have no meaning without the match; watchlist rows already cascade the same way).
- Player deleted → `Restrict` while participants exist. Today Player delete only cascades follows; with match history attached, a player with results should be inactivated, not deleted, mirroring the existing Team → Match `Restrict`. The admin delete error message pattern from Phase 3 applies.
- Team deleted → `Restrict` while participants exist (today: refused while matches or players exist; unchanged in spirit).
- League / Season / Venue: unchanged.

## 18. Phase 4 Sync Impact

Future `NormalizedMatch`:

```ts
type NormalizedParticipant = { kind: "team"; externalId: string } | { kind: "player"; externalId: string }
type NormalizedSide = { participants: NormalizedParticipant[]; score?: number }
type NormalizedMatch = {
  externalId, leagueExternalId, seasonExternalId, venueExternalId?,
  startsAt, status, rawStatus?, stage?, liveDetail?,
  sides: [NormalizedSide, NormalizedSide]   // A then B; A is home when the sport has home advantage
}
```

Adapters emit sides rather than home/away ids; that is the only adapter-visible change. The mock basketball adapter would map `home_id → sides[0].participants[0]`, `visitor_id → sides[1]`, `home_pts / visitor_pts → sides[].score`. A tennis adapter emits player participants; a doubles adapter emits two per side in the provider's listed order. The sync service stays sport-agnostic: it resolves each participant's external id through the team or player maps it already builds, validates counts against `Sport.participantKind` / `maxPerSide`, and rejects the fixture as a record-level error when a participant cannot be resolved (same PARTIAL behaviour as today).

Repository write per match: upsert the `Match` row by `(dataSourceId, externalId)` as now, then reconcile participants as a set inside one short transaction: load existing rows for the match, upsert by `(matchId, side, order)`, delete rows not present in the snapshot. This is the one place where deleting is correct, because participants are owned by the match and the provider is authoritative for its own match's line-up. Idempotency follows from the deterministic key. External ids on participants are not needed (section 15).

## 19. Query Impact

"A team or player participates in a match" becomes `participants: { some: { teamId } }` or `{ playerId }`, or `{ teamId: { in } }` for lists. Prisma compiles these to `EXISTS` subqueries against the participant indexes.

| Query | Today | After |
|---|---|---|
| `getMatches`, `getScheduleMatches`, `getFinishedMatches`, `getLeagueFixtures`, `getLeagueResults`, `getRelatedMatches`, `getMatchById` | filter by league/status/time | unchanged filters; include `participants` with `team` and `player` instead of `homeTeam` / `awayTeam` |
| `getTeamFixtures`, `getTeamResults` | `homeTeamId = X OR awayTeamId = X` | `participants: { some: { teamId: X } }` |
| `getTeamViews` (next match per team) | one query over `OR` of two `in` lists, then first-seen per team | `participants: { some: { teamId: { in } } }`, then first-seen per team by walking `sides` |
| `getTodaysMatches`, `getUpcomingFollowedMatches` | followed team ids on either column | `participants: { some: { teamId: { in } } }` plus league filter; followed *players* can now match individual fixtures directly (new capability, optional) |
| `getPlayerViews`, `getPlayerById` | player → team → league | unchanged for team sports; for individual sports the player page lists `participants: { some: { playerId } }` instead of the team's fixtures |
| `lib/schedule.ts` `filterMatches` (team filter), `matchesSearch`, `history-view` search | two team fields | iterate `sides[].participants[]` |

Cost: one extra join per match list; the participant table has two rows per team match and up to four for doubles, all index-backed. Statement counts stay batched as in Phase 1.

## 20. UI Impact

| Area | Change | Why |
|---|---|---|
| Schedule (`schedule-view`, `match-day-list`, `match-row`) | Small mapping | Row renders `sides[0]` and `sides[1]`; each side renders one team line or one-or-two player lines; winner from `scoreA` / `scoreB` |
| Matches overview | Small mapping | Same row component; search iterates participants |
| Match Detail (`match-scoreboard`, page title) | Small-to-medium | Two blocks become two side blocks; a side with players shows avatars and player links; "Home"/"Away" role from `isHome`; title joins side labels |
| Watchlist | None | Keyed by match id; uses the shared row |
| Dashboard | Small | Followed-team stat and lists use the shared row and the new participation helper |
| Team Detail (`team-row`, fixtures, results) | Small | Opponent = the other side's participants; "at" wording from `isHome` |
| Player Detail | Small for team sports, meaningful for individual sports | Today shows the team's fixtures; individual sports need "this player's matches" and no team header |
| League Detail | Small | Uses shared lists |
| Admin Matches | Meaningful | Form must switch between team selects and player selects (one or two per side) driven by `Sport.participantKind` / `maxPerSide`; validation rules from section 16; table "Participants" cell renders sides |

No component needs a league-specific branch; `isHome` and the sport's participant kind carry every presentational decision.

## 21. Migration Strategy

Data volume is tiny (28 matches, 8 provider-owned), so the mechanics are simple; the risk is in the code cutover, not the data.

1. **Migration 1 (additive).** Add enums, `Sport.participantKind` and `maxPerSide` (defaults `TEAM` / 1 fit every existing sport), `Match.scoreA` / `scoreB` (nullable), the `MatchParticipant` table with its constraints and indexes. Backfill in the same migration with plain SQL:
   ```sql
   INSERT INTO "MatchParticipant" (id, "matchId", side, "order", "teamId")
     SELECT gen_random_uuid()::text, id, 'A', 1, "homeTeamId" FROM "Match"
     UNION ALL
     SELECT gen_random_uuid()::text, id, 'B', 1, "awayTeamId" FROM "Match";
   UPDATE "Match" SET "scoreA" = "homeScore", "scoreB" = "awayScore";
   ```
   Old columns stay, made nullable, so the previous code version still runs against this schema (rollback safety).
2. **Code cutover (one release).** Mappers, repositories, queries, sync types, mock adapter, admin form, seed, and the nine UI files from section 3 switch to participants and side scores. Seed writes participants for its 20 matches. The sync repository reconciles participants (section 18).
3. **Migration 2 (destructive, after one stable release).** Drop `homeTeamId`, `awayTeamId`, `homeScore`, `awayScore`, their relations and indexes. Add CHECK constraints for the repository rules if desired.

Existing internal ids, watchlist rows, follows, and provider external ids are untouched. Rollback before step 3 is redeploying the previous code; the old columns are still populated because step 1 never cleared them. Rollback after step 3 requires restoring columns from participants (the inverse SQL), which is straightforward while every match has exactly two team participants.

## 22. Backward Compatibility

Options: hard cutover; dual-read; dual-write; new tables then remove old fields later.

Recommendation: **D, compressed**. Add the table and backfill (migration 1), cut the code over in one release, drop the columns in a following migration. This gives a real rollback window without dual-read or dual-write code paths, which would double the coupling surface in a codebase where 21 files already touch these fields. Dual-write is not worth it at MVP scale; hard cutover in a single migration removes the rollback safety for no gain.

## 23. MUST HAVE / NICE TO HAVE / DEFER

**MUST HAVE (when an individual sport is added)**
- `MatchParticipant` with `matchId`, `side`, `order`, `teamId?` / `playerId?` and the three unique constraints
- `Sport.participantKind` and `Sport.maxPerSide`
- Aggregate scores per side on `Match`
- Repository rules: XOR team/player, homogeneous kind per side, side sizes, paired scores
- Participation queries via the relation; `MatchView.sides`
- Sync: `NormalizedMatch.sides`, set reconciliation of participants
- Admin form switching on participant kind
- Backfill migration and the delayed column drop

**NICE TO HAVE**
- Renaming score columns to `scoreA` / `scoreB` in the same cutover
- Followed players surfacing their own individual fixtures on the dashboard
- CHECK constraints for the XOR and paired-score rules
- A `matchInvolves(match, { teamId | playerId })` helper shared by UI filters

**DEFER**
- `MatchSide` table (trigger: more than two sides, per-side metadata, or provider side ids)
- Set / game / map / period scores (`MatchPeriod`)
- Rosters, lineups, substitutions, statistics
- Seeds, rankings, captains
- Tournament brackets
- Per-match neutral-venue flag
- League-level Home/Away overrides

## 24. Recommended Next Phase

Do not implement this until the first individual sport (or its provider) is actually being added; the current model is correct for everything in the database and the cutover touches 21 files. When that trigger arrives, run it as one phase: migration 1 with backfill, code cutover with the seed and mock adapter updated, verification against the existing 20 seeded and 8 synced matches (same ids, same scores, same UI), then migration 2. The first individual-sport adapter should be written against the new `NormalizedMatch.sides` contract and should be the acceptance test for the model.

## 25. Open Questions

1. Score column naming: rename to `scoreA` / `scoreB` during the cutover, or keep names and document side semantics?
2. Should followed players' individual matches appear in dashboard "followed" queries, or only followed teams' matches as today?
3. Player Detail for individual sports: is a player without a team (nullable `teamId`, allowed by the schema) acceptable on user-facing pages, given the current domain `Player.teamId` is required and repositories filter team-less players out?
4. Table tennis and badminton team events: represent as team participants (simple) or as player participants with a team attribution (needs a `teamId` on a player participant, which section 16's kind rule currently forbids)?
5. Provider ordering: is "side A is the provider's home side" a safe universal convention, or will some feed require an explicit home flag per match (section 14's deferred boolean)?
6. Delete policy change for players with history (`Restrict`) needs a product decision, since it changes Admin behaviour from Phase 3.

---

## 26. Implementation (Phase 5, implemented 2026-09-15)

The model from sections 11 and 12 is now in the schema and the code. This section records what was built and where it deviates from the recommendation above.

### What was built

| Area | Implementation |
|---|---|
| Schema | `enum MatchSide { A B }`; `model MatchParticipant { id, matchId, side, order, teamId?, playerId? }` with `@@unique([matchId, side, order])`, `@@unique([matchId, teamId])`, `@@unique([matchId, playerId])`, indexes on `matchId`, `teamId`, `playerId`; `Match.sideAScore` / `Match.sideBScore` replace `homeScore` / `awayScore`; `Match.homeTeamId` / `awayTeamId` and the `HomeTeam` / `AwayTeam` relations are gone. No `MatchSide` table, no `Pair`, no `PAIR` kind, no tournament model. |
| Database CHECKs (migration SQL) | `Match_scores_paired` (both scores null or both set), `MatchParticipant_one_ref` (exactly one of `teamId` / `playerId`), `MatchParticipant_order_positive` (`order >= 1`). |
| Migrations | `20260915061141_match_participants` (additive: enum, table, score columns, legacy columns made nullable, backfill `homeTeamId → A/1`, `awayTeamId → B/1`, scores copied, CHECKs) and `20260915063143_drop_legacy_match_sides` (a `DO $$` guard that aborts unless every legacy side and score is mirrored, then drops the columns, relations and indexes). Backfilled participant ids are `'mp_' \|\| md5(matchId \|\| ':A:1')`, deterministic and preserved by the seed. |
| Domain types (`lib/data/types.ts`) | `MatchSide`, `MatchParticipant`, `MatchParticipantView = MatchParticipant & { team?; player? }`, `Match.participants`, `MatchScore { a, b }`, `MatchView = Match & { league; participants: MatchParticipantView[] }`, `Player.teamId?` optional, `PlayerView.team?` / `league?` optional (league derived from the team or from the latest participation's match). |
| Shared validation (`lib/data/match-participants.ts`) | `validateParticipants`: both sides non-empty, exactly one reference per row, positions integers from 1 and unique per side, a team or player at most once per match, homogeneous sides, one team per team side, any number of players per player side. Used by the admin repository, the sync service and the seed. |
| Presentation (`lib/matches.ts`) | `sideParticipants`, `sideRole` (Home/Away from `hasHomeAdvantage`, else none), `participantName`, `sideName` (doubles join with " / "), `matchTitle`, `sideScore`, `winnerSide`, `sideOf`, `matchInvolvesTeam` / `matchInvolvesPlayer`, `participantSearchTerms`. Components render `SIDES.map(...)`; none reads a sport id. |
| Repositories | `matchInclude` loads `participants` with `team` and `player`, ordered by side then position (one query per list, no N+1). `MatchQuery.teamIds` / `playerIds` / `followed.playerIds` filter through `participants: { some: ... }`. Team next-match and player fixtures go through participants. Player repository no longer filters team-less players. Admin `saveMatch` validates participants, checks team participants and the season belong to the league, checks player participants exist, and writes the match plus a full participant replacement in one transaction. `deletePlayer` maps the FK restriction to a clear message. |
| Sync | `lib/data/sync/participants.ts` reduces `NormalizedMatch` (home → side A, away → side B) and `NormalizedIndividualMatch` to one persistable form and resolves external ids to internal ids through the maps the service built. `syncRepository.upsertMatch` takes participants and reconciles them as a set (unchanged sets untouched, changed sets replaced in the match's transaction). The tennis "not stored" blocker is removed; nothing in the service is tennis-specific. |
| UI | `components/matches/side-participants.tsx` (`SideName`, `ParticipantAvatars`), match rows, scoreboard, team rows, history search, followed-team card, match page title, player card and player page (team-less players show "Independent" and their own matches). Admin match form is a participant editor: per side a list of team-or-player selects, add/remove, options exclude anything already picked, validation messages from the shared module, side labels Home/Away or Side A/Side B from the registry. Admin players allow "No team (individual)". |
| Seed | Every mock match carries `participants`; participants are upserted by `(matchId, side, order)` so backfilled ids survive. New deterministic tennis data: league `wimbledon` (sport `tennis`), season `s-wim-2026`, venue `v-centre-court`, six team-less players, one finished singles (`m-wim-alcaraz-sinner`, 3–1), one upcoming singles, one upcoming doubles (`m-wim-doubles-final`). The demo user follows `alcaraz`. |
| Tests | `tests/domain/match-participants.test.ts` (rules, mock dataset invariants, no fake tennis teams), `tests/domain/matches.test.ts` (Home/Away from the registry, team behaviour unchanged, singles and doubles rendering, search terms), `tests/sync/participants.test.ts` (team and player side conversion, lone scores, unknown references, shared rules). The 17 tennis-provider tests are unchanged. |

### Deviations from the recommendation

- `Sport.participantKind` and `Sport.maxPerSide` (section 12) were **not** added. The side-shape rule that matters today, "a team side holds one team, a player side holds one or more players", is sport-independent and lives in `validateParticipants`. A per-sport limit (badminton doubles = exactly 2) can be added to the registry later without a schema change.
- Score columns are named `sideAScore` / `sideBScore` (open question 1 resolved: rename, with side-neutral names).
- The two "nice to have" items, CHECK constraints and a shared `matchInvolves*` helper, are in.
- Migration 2 was applied in the same phase rather than after a stable release; the additive migration and a fidelity guard inside the drop migration cover the data-safety concern at this data volume.

### Open questions, resolved

1. Score naming: `sideAScore` / `sideBScore`.
2. Followed players' own matches appear in the dashboard "followed" queries (today's matches and upcoming), alongside followed teams and leagues.
3. Team-less players are first-class on user-facing pages: listed, followable, with their league derived from their matches, and shown as "Independent".
4. Table tennis / badminton team events: still deferred; would be team participants.
5. Provider ordering: "provider home → side A" is the convention for every adapter; no explicit home flag was needed.

### Badminton readiness

Adding badminton is: a `badminton` entry in `lib/sports.ts` with `homeAway: false`, a `Sport` row, and an adapter that emits `NormalizedIndividualMatch` with one or two players per side. No schema, repository, query, or component change.

### Not verified

A real Sportradar tennis sync could not be run in this environment because `SPORTRADAR_API_KEY` is not configured. The persistence path is covered by the sync participant tests and the seeded tennis matches; the end-to-end feed run is pending a key.
