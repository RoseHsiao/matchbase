import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { ReminderEmailSettings } from "@/components/notifications/reminder-email-settings";
import { WatchlistView } from "@/components/watchlist/watchlist-view";
import { getWatchlistMatches } from "@/lib/data/queries";
import { signInHref } from "@/lib/auth/redirect";
import { getViewer } from "@/lib/auth/session";
import { db } from "@/lib/data/db";
import { getNavItem } from "@/lib/navigation";
import { readReminderEmailSettings, reminderEmailsAvailable } from "@/lib/notifications/preferences-ops";

const nav = getNavItem("/watchlist");

export const metadata: Metadata = {
  title: nav.title,
  description: nav.description,
};

export default async function WatchlistPage() {
  const viewer = await getViewer();
  if (!viewer) redirect(signInHref("/watchlist"));

  const now = new Date();
  const [matches, settings] = await Promise.all([getWatchlistMatches(), readReminderEmailSettings(db, viewer.id)]);
  const mailAvailable = reminderEmailsAvailable(process.env);

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
