import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDaysIcon } from "lucide-react";

import { FollowedTeams } from "@/components/dashboard/followed-teams";
import { QuickStats } from "@/components/dashboard/quick-stats";
import { TodaysMatches } from "@/components/dashboard/todays-matches";
import { UpcomingMatches } from "@/components/dashboard/upcoming-matches";
import { WatchlistPreview } from "@/components/dashboard/watchlist-preview";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { formatLongDate } from "@/lib/format";
import { getNavItem } from "@/lib/navigation";

const nav = getNavItem("/dashboard");

export const metadata: Metadata = {
  title: nav.title,
  description: nav.description,
};

export default function DashboardPage() {
  // One reference time for the whole page so every "Today" label agrees.
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${formatLongDate(now)} · Here's what's on for the teams you follow.`}
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

      <QuickStats now={now} />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="grid min-w-0 content-start gap-6 xl:col-span-2">
          <TodaysMatches now={now} />
          <UpcomingMatches now={now} />
        </div>
        <div className="grid min-w-0 content-start gap-6">
          <WatchlistPreview now={now} />
          <FollowedTeams now={now} />
        </div>
      </div>
    </>
  );
}
