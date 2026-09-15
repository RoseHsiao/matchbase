import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { DetailList } from "@/components/detail-list";
import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/layout/section-card";
import { MatchList } from "@/components/matches/match-list";
import { TeamLogo } from "@/components/matches/team-logo";
import { PlayerAvatar } from "@/components/players/player-avatar";
import { PlayerFollowButton } from "@/components/players/player-follow-button";
import { buttonVariants } from "@/components/ui/button";
import {
  getPlayerById,
  getPlayerFixtures,
  getPlayerResults,
  getTeamFixtures,
  getTeamResults,
} from "@/lib/data/queries";
import { playerDisplayName } from "@/lib/players";
import { categoryLabel, sportCategory, sportLabel } from "@/lib/sports";

type PlayerPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: PlayerPageProps): Promise<Metadata> {
  const { id } = await params;
  const player = await getPlayerById(id);
  return {
    title: player ? playerDisplayName(player) : "Player",
    description: player
      ? [player.role, player.team?.name, player.league?.name].filter(Boolean).join(" · ")
      : undefined,
  };
}

/**
 * Team players show their team's fixtures; individual athletes (no team)
 * show the matches they take part in directly.
 */
export default async function PlayerPage({ params }: PlayerPageProps) {
  const { id } = await params;
  const player = await getPlayerById(id);
  if (!player) notFound();

  const now = new Date();
  const team = player.team;
  const [fixtures, results] = await Promise.all(
    team
      ? [getTeamFixtures(team.id, now), getTeamResults(team.id)]
      : [getPlayerFixtures(player.id, now), getPlayerResults(player.id)]
  );
  const displayName = playerDisplayName(player);
  const subject = team ? team.shortName : displayName;
  const league = player.league;

  const teamLink = team ? (
    <Link
      href={`/teams/${team.id}`}
      className="inline-flex items-center gap-1.5 rounded-md outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <TeamLogo team={team} size="xs" />
      {team.name}
    </Link>
  ) : (
    <span className="text-muted-foreground">Independent</span>
  );

  return (
    <>
      <div className="grid gap-3">
        <Link
          href="/players"
          className={buttonVariants({
            variant: "ghost",
            size: "sm",
            className: "w-fit -ml-2",
          })}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          All players
        </Link>
        <div className="flex items-start gap-4">
          <PlayerAvatar player={player} size="xl" />
          <PageHeader
            className="min-w-0 flex-1"
            title={displayName}
            description={[
              player.handle ? player.name : null,
              player.role || null,
              team?.name ?? null,
              league?.name ?? null,
            ]
              .filter(Boolean)
              .join(" · ")}
            actions={
              <PlayerFollowButton
                playerId={player.id}
                playerName={displayName}
                size="lg"
                followedLabel="Unfollow"
              />
            }
          />
        </div>
      </div>

      <SectionCard title="Player information" contentClassName="px-4">
        <DetailList
          items={[
            { label: "Team", value: teamLink },
            ...(player.role ? [{ label: "Role", value: player.role }] : []),
            ...(league
              ? [
                  { label: "Category", value: categoryLabel(sportCategory(league.sport)) },
                  { label: "Sport / Game", value: sportLabel(league.sport) },
                  {
                    label: "League",
                    value: (
                      <Link href={`/leagues/${league.id}`} className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">
                        {league.name}
                      </Link>
                    ),
                  },
                ]
              : []),
            ...(player.nationality
              ? [{ label: "Nationality", value: player.nationality }]
              : []),
            ...(player.number !== undefined
              ? [{ label: "Number", value: `#${player.number}` }]
              : []),
            ...(player.handle ? [{ label: "Full name", value: player.name }] : []),
          ]}
        />
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard
          title={`Upcoming for ${subject}`}
          description={team ? "Live and scheduled fixtures for the player's team" : "Live and scheduled matches"}
          href={team ? `/teams/${team.id}` : undefined}
          actionLabel={team ? "Team page" : undefined}
        >
          <MatchList
            matches={fixtures}
            now={now}
            emptyTitle="No upcoming matches"
            emptyDescription={`Nothing is scheduled for ${subject} right now.`}
          />
        </SectionCard>

        <SectionCard
          title={`Recent results for ${subject}`}
          description="Most recent first"
        >
          <MatchList
            matches={results}
            now={now}
            emptyTitle="No results yet"
            emptyDescription={`Finished matches for ${subject} will appear here.`}
          />
        </SectionCard>
      </div>
    </>
  );
}
