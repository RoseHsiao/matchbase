import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { MatchesView } from "@/components/matches/matches-view";
import { getLeagues, getMatches, getTeams } from "@/lib/data/queries";
import { getNavItem } from "@/lib/navigation";

const nav = getNavItem("/matches");

export const metadata: Metadata = {
  title: nav.title,
  description: nav.description,
};

export default async function MatchesPage() {
  const now = new Date();
  const [matches, leagues, teams] = await Promise.all([
    getMatches(),
    getLeagues(),
    getTeams(),
  ]);

  return (
    <>
      <PageHeader
        title="Matches"
        description="Browse every sports and esports match in one place. Search, filter by category, sport or game, league, team, and status, and save matches to your watchlist."
      />
      <MatchesView matches={matches} leagues={leagues} teams={teams} now={now.toISOString()} />
    </>
  );
}
