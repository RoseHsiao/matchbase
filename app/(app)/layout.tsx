import { cookies } from "next/headers";

import { ViewerProvider } from "@/components/auth/viewer-provider";
import { AppShell } from "@/components/layout/app-shell";
import { BreadcrumbDataProvider } from "@/components/layout/breadcrumb-data-provider";
import { PlayerFollowsProvider } from "@/components/players/player-follows-provider";
import { FollowsProvider } from "@/components/teams/follows-provider";
import { WatchlistProvider } from "@/components/watchlist/watchlist-provider";
import { WatchlistRemindersProvider } from "@/components/watchlist/watchlist-reminders-provider";
import { getViewer } from "@/lib/auth/session";
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
 * Resolves the viewer once per request, seeds the client-side follow and
 * watchlist stores with that viewer's rows (empty for an anonymous
 * visitor, whose stores are read-only and prompt sign-in), and hands each
 * store the server action that persists changes.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [viewer, cookieStore, watchlistIds, watchlistEntries, followedTeamIds, followedPlayerIds, leagues] =
    await Promise.all([
      getViewer(),
      cookies(),
      getWatchlistIds(),
      getWatchlistEntries(),
      getFollowedTeamIds(),
      getFollowedPlayerIds(),
      getLeagues(),
    ]);
  const readOnly = viewer === null;
  const defaultOpen = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value !== "false";
  const leagueCrumbs = leagues.map(({ id, name, sport }) => ({ id, name, sport }));

  return (
    <ViewerProvider viewer={viewer}>
      <WatchlistProvider initialIds={watchlistIds} persist={setMatchWatchlisted} readOnly={readOnly}>
        <WatchlistRemindersProvider initialEntries={watchlistEntries} persist={setWatchlistReminder} readOnly={readOnly}>
          <FollowsProvider initialIds={followedTeamIds} persist={setTeamFollowed} readOnly={readOnly}>
            <PlayerFollowsProvider initialIds={followedPlayerIds} persist={setPlayerFollowed} readOnly={readOnly}>
              <BreadcrumbDataProvider leagues={leagueCrumbs}>
                <AppShell defaultOpen={defaultOpen}>{children}</AppShell>
              </BreadcrumbDataProvider>
            </PlayerFollowsProvider>
          </FollowsProvider>
        </WatchlistRemindersProvider>
      </WatchlistProvider>
    </ViewerProvider>
  );
}
