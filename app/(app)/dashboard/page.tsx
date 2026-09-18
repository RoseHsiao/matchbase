import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDaysIcon } from "lucide-react";

import { DashboardSummary } from "@/components/dashboard/dashboard-summary";
import { Following } from "@/components/dashboard/following";
import { TodaysMatches } from "@/components/dashboard/todays-matches";
import { UpcomingMatches } from "@/components/dashboard/upcoming-matches";
import { WatchlistPreview } from "@/components/dashboard/watchlist-preview";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { getViewer } from "@/lib/auth/session";
import { getQuickStats, getTodaysMatches } from "@/lib/data/queries";
import { formatLongDate } from "@/lib/format";
import { getNavItem } from "@/lib/navigation";

const nav = getNavItem("/dashboard");

export const metadata: Metadata = {
  title: nav.title,
  description: nav.description,
};

/**
 * Information hierarchy, top to bottom: today's matches (the reason to open
 * the app), the watchlist with its reminders, what the user follows, then
 * what is coming up. On wide screens "Following" sits beside the watchlist
 * and upcoming panels; DOM order keeps the phone reading order.
 */
export default async function DashboardPage() {
  // One reference time for the whole page so every "Today" label agrees.
  const now = new Date();
  const [viewer, today, stats] = await Promise.all([getViewer(), getTodaysMatches(now), getQuickStats()]);
  const live = today.filter((match) => match.status === "live").length;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${formatLongDate(now)} · ${viewer ? "Your sports and esports command center: follow, save, set a reminder, watch." : "Today across every league. Sign in to follow, save and set reminders."}`}
        actions={
          <Link
            href="/schedule"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <CalendarDaysIcon data-icon="inline-start" />
            Full schedule
          </Link>
        }
      />

      <DashboardSummary followedLeagues={stats.followedLeagues} todayCount={today.length} liveCount={live} />

      <TodaysMatches matches={today} now={now} personal={viewer !== null} />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <WatchlistPreview now={now} limit={6} />
        </div>
        <div className="min-w-0 xl:col-start-3 xl:row-span-2 xl:row-start-1">
          <Following now={now} />
        </div>
        <div className="min-w-0 xl:col-span-2">
          <UpcomingMatches now={now} />
        </div>
      </div>
    </>
  );
}
