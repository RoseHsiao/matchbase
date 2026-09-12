import type { Metadata } from "next";

import { HistoryView } from "@/components/history/history-view";
import { PageHeader } from "@/components/layout/page-header";
import { getFinishedMatches, getLeagues, getTeams } from "@/lib/data/queries";
import { getNavItem } from "@/lib/navigation";

const nav = getNavItem("/history");

export const metadata: Metadata = {
  title: nav.title,
  description: nav.description,
};

export default async function HistoryPage() {
  const now = new Date();
  const [matches, leagues, teams] = await Promise.all([
    getFinishedMatches(),
    getLeagues(),
    getTeams(),
  ]);

  return (
    <>
      <PageHeader
        title="History"
        description="Completed matches across sports and esports, newest first. Matches you had on your watchlist are marked as watched."
      />
      <HistoryView matches={matches} leagues={leagues} teams={teams} now={now.toISOString()} />
    </>
  );
}
