import { cookies } from "next/headers";

import { AppShell } from "@/components/layout/app-shell";
import { PlayerFollowsProvider } from "@/components/players/player-follows-provider";
import { FollowsProvider } from "@/components/teams/follows-provider";
import { WatchlistProvider } from "@/components/watchlist/watchlist-provider";
import {
  getFollowedPlayerIds,
  getFollowedTeamIds,
  getWatchlistIds,
} from "@/lib/data/queries";

const SIDEBAR_COOKIE_NAME = "sidebar_state";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [cookieStore, watchlistIds, followedTeamIds, followedPlayerIds] =
    await Promise.all([
      cookies(),
      getWatchlistIds(),
      getFollowedTeamIds(),
      getFollowedPlayerIds(),
    ]);
  const defaultOpen = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value !== "false";

  return (
    <WatchlistProvider initialIds={watchlistIds}>
      <FollowsProvider initialIds={followedTeamIds}>
        <PlayerFollowsProvider initialIds={followedPlayerIds}>
          <AppShell defaultOpen={defaultOpen}>{children}</AppShell>
        </PlayerFollowsProvider>
      </FollowsProvider>
    </WatchlistProvider>
  );
}
