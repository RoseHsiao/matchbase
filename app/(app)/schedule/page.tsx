import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { ScheduleView } from "@/components/schedule/schedule-view";
import { getLeagues, getScheduleMatches, getTeams } from "@/lib/data/queries";
import { getNavItem } from "@/lib/navigation";

const nav = getNavItem("/schedule");

/** Days shown in the schedule, starting today. */
const SCHEDULE_DAYS = 7;

export const metadata: Metadata = {
  title: nav.title,
  description: nav.description,
};

export default async function SchedulePage() {
  const now = new Date();
  const [matches, leagues, teams] = await Promise.all([
    getScheduleMatches(SCHEDULE_DAYS, now),
    getLeagues(),
    getTeams(),
  ]);

  return (
    <>
      <PageHeader
        title="Schedule"
        description="Browse upcoming sports and esports matches for today and the week ahead."
      />
      <ScheduleView
        matches={matches}
        leagues={leagues}
        teams={teams}
        now={now.toISOString()}
        days={SCHEDULE_DAYS}
      />
    </>
  );
}
