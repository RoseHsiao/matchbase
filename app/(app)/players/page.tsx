import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { PlayersView } from "@/components/players/players-view";
import { getLeagues, getPlayerViews, getTeams } from "@/lib/data/queries";
import { getNavItem } from "@/lib/navigation";

const nav = getNavItem("/players");

export const metadata: Metadata = {
  title: nav.title,
  description: nav.description,
};

export default async function PlayersPage() {
  const [players, leagues, teams] = await Promise.all([
    getPlayerViews(),
    getLeagues(),
    getTeams(),
  ]);

  return (
    <>
      <PageHeader
        title="Players"
        description="Browse players across sports and esports, and follow the ones you want to keep up with."
      />
      <PlayersView players={players} leagues={leagues} teams={teams} />
    </>
  );
}
