import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { WatchlistView } from "@/components/watchlist/watchlist-view";
import { getWatchlistMatches } from "@/lib/data/queries";
import { getNavItem } from "@/lib/navigation";

const nav = getNavItem("/watchlist");

export const metadata: Metadata = {
  title: nav.title,
  description: nav.description,
};

export default async function WatchlistPage() {
  const now = new Date();
  const matches = await getWatchlistMatches();

  return (
    <>
      <PageHeader
        title="Watchlist"
        description="Matches you've saved to watch. Add more from the Schedule or any match page."
      />
      <WatchlistView matches={matches} now={now.toISOString()} />
    </>
  );
}
