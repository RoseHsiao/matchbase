import { cookies } from "next/headers";

import { AppShell } from "@/components/layout/app-shell";
import { WatchlistProvider } from "@/components/watchlist/watchlist-provider";
import { getWatchlistIds } from "@/lib/data/queries";

const SIDEBAR_COOKIE_NAME = "sidebar_state";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [cookieStore, watchlistIds] = await Promise.all([
    cookies(),
    getWatchlistIds(),
  ]);
  const defaultOpen = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value !== "false";

  return (
    <WatchlistProvider initialIds={watchlistIds}>
      <AppShell defaultOpen={defaultOpen}>{children}</AppShell>
    </WatchlistProvider>
  );
}
