import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StarIcon } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/layout/section-card";
import { MatchScoreboard } from "@/components/matches/match-scoreboard";
import { Badge } from "@/components/ui/badge";
import { getMatchById, isMatchWatchlisted } from "@/lib/data/queries";

type MatchPageProps = {
  params: Promise<{ matchId: string }>;
};

export async function generateMetadata({
  params,
}: MatchPageProps): Promise<Metadata> {
  const { matchId } = await params;
  const match = await getMatchById(matchId);
  return {
    title: match
      ? `${match.homeTeam.shortName} vs ${match.awayTeam.shortName}`
      : "Match",
  };
}

export default async function MatchPage({ params }: MatchPageProps) {
  const { matchId } = await params;
  const match = await getMatchById(matchId);
  if (!match) notFound();

  const watchlisted = await isMatchWatchlisted(match.id);
  const now = new Date();

  return (
    <>
      <PageHeader
        title={`${match.homeTeam.name} vs ${match.awayTeam.name}`}
        description={match.league.name}
        actions={
          watchlisted ? (
            <Badge variant="secondary">
              <StarIcon data-icon="inline-start" />
              On your watchlist
            </Badge>
          ) : null
        }
      />

      <MatchScoreboard match={match} now={now} />

      <SectionCard
        title="Match details"
        description="Lineups, stats, and timeline will appear here once the data layer is connected."
        contentClassName="px-4 text-sm text-muted-foreground"
      >
        Coming soon.
      </SectionCard>
    </>
  );
}
