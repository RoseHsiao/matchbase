import { cookies } from "next/headers";

import { AppShell } from "@/components/layout/app-shell";
import { FollowsProvider } from "@/components/teams/follows-provider";
import { WatchlistProvider } from "@/components/watchlist/watchlist-provider";
import { getFollowedTeamIds, getWatchlistIds } from "@/lib/data/queries";

const SIDEBAR_COOKIE_NAME = "sidebar_state";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [cookieStore, watchlistIds, followedTeamIds] = await Promise.all([
    cookies(),
    getWatchlistIds(),
    getFollowedTeamIds(),
  ]);
  const defaultOpen = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value !== "false";

  return (
    <WatchlistProvider initialIds={watchlistIds}>
      <FollowsProvider initialIds={followedTeamIds}>
        <AppShell defaultOpen={defaultOpen}>{children}</AppShell>
      </FollowsProvider>
    </WatchlistProvider>
  );
}
