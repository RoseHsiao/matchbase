import { cookies } from "next/headers";

import { AppShell } from "@/components/layout/app-shell";
import { BreadcrumbDataProvider } from "@/components/layout/breadcrumb-data-provider";
import { PlayerFollowsProvider } from "@/components/players/player-follows-provider";
import { FollowsProvider } from "@/components/teams/follows-provider";
import { WatchlistProvider } from "@/components/watchlist/watchlist-provider";
import {
  getFollowedPlayerIds,
  getFollowedTeamIds,
  getLeagues,
  getWatchlistIds,
} from "@/lib/data/queries";

const SIDEBAR_COOKIE_NAME = "sidebar_state";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [cookieStore, watchlistIds, followedTeamIds, followedPlayerIds, leagues] =
    await Promise.all([
      cookies(),
      getWatchlistIds(),
      getFollowedTeamIds(),
      getFollowedPlayerIds(),
      getLeagues(),
    ]);
  const defaultOpen = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value !== "false";
  const leagueCrumbs = leagues.map(({ id, name, sport }) => ({ id, name, sport }));

  return (
    <WatchlistProvider initialIds={watchlistIds}>
      <FollowsProvider initialIds={followedTeamIds}>
        <PlayerFollowsProvider initialIds={followedPlayerIds}>
          <BreadcrumbDataProvider leagues={leagueCrumbs}>
            <AppShell defaultOpen={defaultOpen}>{children}</AppShell>
          </BreadcrumbDataProvider>
        </PlayerFollowsProvider>
      </FollowsProvider>
    </WatchlistProvider>
  );
}
