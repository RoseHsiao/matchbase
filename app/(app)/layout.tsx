import { cookies } from "next/headers";

import { AppShell } from "@/components/layout/app-shell";
import { BreadcrumbDataProvider } from "@/components/layout/breadcrumb-data-provider";
import { PlayerFollowsProvider } from "@/components/players/player-follows-provider";
import { FollowsProvider } from "@/components/teams/follows-provider";
import { WatchlistProvider } from "@/components/watchlist/watchlist-provider";
import { WatchlistRemindersProvider } from "@/components/watchlist/watchlist-reminders-provider";
import {
  getFollowedPlayerIds,
  getFollowedTeamIds,
  getLeagues,
  getWatchlistEntries,
  getWatchlistIds,
} from "@/lib/data/queries";
import {
  setMatchWatchlisted,
  setPlayerFollowed,
  setTeamFollowed,
  setWatchlistReminder,
} from "@/lib/data/user-state-actions";

const SIDEBAR_COOKIE_NAME = "sidebar_state";

/**
 * Seeds the client-side follow and watchlist stores from the database on
 * every render and hands each store the server action that persists changes.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [cookieStore, watchlistIds, watchlistEntries, followedTeamIds, followedPlayerIds, leagues] =
    await Promise.all([
      cookies(),
      getWatchlistIds(),
      getWatchlistEntries(),
      getFollowedTeamIds(),
      getFollowedPlayerIds(),
      getLeagues(),
    ]);
  const defaultOpen = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value !== "false";
  const leagueCrumbs = leagues.map(({ id, name, sport }) => ({ id, name, sport }));

  return (
    <WatchlistProvider initialIds={watchlistIds} persist={setMatchWatchlisted}>
      <WatchlistRemindersProvider initialEntries={watchlistEntries} persist={setWatchlistReminder}>
        <FollowsProvider initialIds={followedTeamIds} persist={setTeamFollowed}>
          <PlayerFollowsProvider initialIds={followedPlayerIds} persist={setPlayerFollowed}>
            <BreadcrumbDataProvider leagues={leagueCrumbs}>
              <AppShell defaultOpen={defaultOpen}>{children}</AppShell>
            </BreadcrumbDataProvider>
          </PlayerFollowsProvider>
        </FollowsProvider>
      </WatchlistRemindersProvider>
    </WatchlistProvider>
  );
}
