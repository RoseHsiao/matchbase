import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { TeamsView } from "@/components/teams/teams-view";
import { getLeagues, getTeamViews } from "@/lib/data/queries";
import { getNavItem } from "@/lib/navigation";

const nav = getNavItem("/teams");

export const metadata: Metadata = {
  title: nav.title,
  description: nav.description,
};

export default async function TeamsPage() {
  const now = new Date();
  const [teams, leagues] = await Promise.all([getTeamViews(now), getLeagues()]);

  return (
    <>
      <PageHeader
        title="Teams"
        description="Browse teams across football, basketball, and esports, and follow the ones you care about."
      />
      <TeamsView teams={teams} leagues={leagues} />
    </>
  );
}
