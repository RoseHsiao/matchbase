# Screenshot guide

The repository contains **no screenshots** as of 2026-09-17. `public/` held only the create-next-app template SVGs, which have been removed. This guide lists what to capture, in what order, and what each image is meant to prove, so that a later capture session produces a coherent story rather than a page tour.

Do not add placeholder images. When captured, put files under `docs/screenshots/` and reference them from the README's overview.

## Before capturing

1. **Move the seed anchor or sync a provider.** The seed fixes every timestamp around 2026-09-14 (`SEED_DAY` in `prisma/seed.ts`). Capture while "today" and "upcoming" sections are populated: either set the machine clock, adjust `SEED_DAY` locally and re-seed, or, if a Sportradar key is available, run the tennis sync so real upcoming fixtures exist. Do not commit an anchor change made only for screenshots.
2. Seed once (`npm run db:seed`) so the demo user has follows, a watchlist with one match per reminder option, and the Wimbledon singles and doubles fixtures.
3. Capture both a desktop width (about 1440 px) and one phone width (about 390 px) for the first two shots; desktop only for the rest.
4. Capture the light theme by default; one dark-theme shot of the Dashboard is enough to show theming.

## Recommended sequence

The order follows the product journey and then drops one level to the architecture. Each shot has one job.

| # | View | Route | What it must show | Why it is in the sequence |
|---|---|---|---|---|
| 1 | **Dashboard** | `/dashboard` | today's matches with live first, the stat cards, the Following panel, the Watchlist panel with a reminder line, the header bell with a count | the "command center" claim in one frame; sports and esports rows side by side |
| 2 | **Schedule** | `/schedule` | the date strip, a day with both a football and an esports fixture, hierarchy filters open on Category → Sport → League | *Schedule* step; shows the shared hierarchy filter |
| 3 | **Match detail: team sport with Home/Away** | `/matches/m-epl-liv-mci` (or any football match) | scoreboard with "Home" / "Away" labels, watchlist star on, reminder select set to "15 min before" with its caption | *Watchlist → Reminder* step; establishes what Home/Away looks like before contrasting it |
| 4 | **Match detail: esports, no Home/Away** | an LCK or LEC match, e.g. `/matches/m-lec-g2-kc` | same layout, no Home/Away labels, esports icon, reminder "at start" | proves side wording is sport metadata: same component, different sport |
| 5 | **Match detail: tennis doubles** | `/matches/m-wim-doubles-final` | two overlapped portraits per side, "Player A / Player B vs Player C / Player D", each name linked, no Home/Away | the strongest single frame for the `MatchParticipant` story |
| 6 | **Player detail: team-less player** | a Wimbledon player under `/players/` (open one from `/matches/m-wim-alcaraz-sinner`) | "Independent" instead of a team, follow button, fixtures and results listed directly | team-less players are first class |
| 7 | **Watchlist** | `/watchlist` | upcoming rows with per-row reminder selects showing different values, the summary line counting reminders | the persisted preference on its own surface |
| 8 | **League detail** | `/leagues/lck` or `/leagues/nba` | seasons, teams, fixtures and results tabs | catalogue depth under one league |
| 9 | **History** | `/history` | finished results across sports and esports | *History* step closes the journey |
| 10 | **Admin: Data Sources** | `/admin/data-sources` | the Provider column showing all three states: "None (placeholder)", "Mock · Deterministic fixtures", "Live · Not configured · SPORTRADAR_API_KEY is not set"; the row menu with "Sync now" | communicates the sync architecture and the honest state of the live integration in one table |
| 11 | **Admin: Sync Logs** | `/admin/sync-logs` after a mock sync and one attempted tennis sync | a SUCCESS row for the mock feed with record counts, a FAILED row for Sportradar with "Configuration error" in Details | shows PARTIAL / FAILED reporting and that nothing is faked |
| 12 | **Admin: Matches form (optional)** | `/admin/matches`, edit a tennis match | the participant editor with player sides | only if a shot of the write path is wanted; otherwise skip, it is CRUD |

Shots 1, 3, 5 and 10 are the minimum set. If only one image can go at the top of the README, use shot 1 (desktop, light).

## What not to capture

- Admin list pages for sports, leagues, seasons, teams, venues: they are generic data tables and read as CRUD.
- Admin Analytics, Monitoring, Settings: placeholders.
- Empty states caused by the seed anchor having aged; fix the anchor first.

## Suggested captions

Short, factual, one line each. Examples:

- "One dashboard for followed teams across football, basketball, League of Legends and tennis."
- "Same match component: Home/Away labels come from sport metadata, not from the page."
- "Tennis doubles as four `MatchParticipant` rows: two players per side, no fake teams."
- "Data Sources: placeholder, mock and live providers are never conflated; the live adapter reports 'Not configured' rather than pretending."
