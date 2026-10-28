import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { ReminderEmailSettings } from "@/components/notifications/reminder-email-settings";
import { WatchlistView } from "@/components/watchlist/watchlist-view";
import { getWatchlistMatches } from "@/lib/data/queries";
import { getViewer } from "@/lib/auth/session";
import { db } from "@/lib/data/db";
import { readMailEnv } from "@/lib/mail/mail-env";
import { getNavItem } from "@/lib/navigation";
import { readReminderEmailSettings } from "@/lib/notifications/preferences-ops";

const nav = getNavItem("/watchlist");

export const metadata: Metadata = {
  title: nav.title,
  description: nav.description,
};

export default async function WatchlistPage() {
  const now = new Date();
  const [matches, viewer] = await Promise.all([getWatchlistMatches(), getViewer()]);
  const settings = viewer ? await readReminderEmailSettings(db, viewer.id) : null;
  const mailAvailable = readMailEnv(process.env).transport.kind !== "disabled";

  return (
    <>
      <PageHeader
        title="Watchlist"
        description="Matches you've saved to watch. Add more from the Schedule or any match page."
      />
      <WatchlistView matches={matches} now={now.toISOString()} />
      {settings ? <ReminderEmailSettings available={mailAvailable} email={settings.email} confirmed={settings.confirmed} enabled={settings.enabled} /> : null}
    </>
  );
}
