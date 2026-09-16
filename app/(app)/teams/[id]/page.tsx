import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, UserRoundIcon } from "lucide-react";

import { DetailList } from "@/components/detail-list";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/layout/section-card";
import { MatchList } from "@/components/matches/match-list";
import { TeamLogo } from "@/components/matches/team-logo";
import { TeamFollowButton } from "@/components/teams/follow-button";
import { buttonVariants } from "@/components/ui/button";
import {
  getTeamById,
  getTeamFixtures,
  getTeamPlayers,
  getTeamResults,
} from "@/lib/data/queries";
import { CategoryLine, SportHierarchy, SportLine } from "@/components/sport-icon";
import { sportCategory, sportLabel } from "@/lib/sports";

type TeamPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: TeamPageProps): Promise<Metadata> {
  const { id } = await params;
  const team = await getTeamById(id);
  return {
    title: team?.name ?? "Team",
    description: team ? `${team.league.name} · ${sportLabel(team.league.sport)}` : undefined,
  };
}

export default async function TeamPage({ params }: TeamPageProps) {
  const { id } = await params;
  const team = await getTeamById(id);
  if (!team) notFound();

  const now = new Date();
  const [fixtures, results, players] = await Promise.all([
    getTeamFixtures(team.id, now),
    getTeamResults(team.id),
    getTeamPlayers(team.id),
  ]);

  return (
    <>
      <div className="grid gap-3">
        <Link
          href="/teams"
          className={buttonVariants({
            variant: "ghost",
            size: "sm",
            className: "w-fit -ml-2",
          })}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          All teams
        </Link>
        <div className="flex items-start gap-4">
          <TeamLogo team={team} size="xl" />
          <PageHeader
            className="min-w-0 flex-1"
            title={team.name}
            description={
              <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span className="font-medium text-foreground">{team.code}</span>
                <span aria-hidden>·</span>
                <SportHierarchy sport={team.league.sport} league={{ id: team.league.id, label: team.league.name }} linked />
              </span>
            }
            actions={
              <TeamFollowButton
                teamId={team.id}
                teamName={team.name}
                size="lg"
                followedLabel="Unfollow"
              />
            }
          />
        </div>
      </div>

      <SectionCard title="Team information" contentClassName="px-4">
        <DetailList
          items={[
            { label: "Abbreviation", value: team.code },
            { label: "Category", value: <CategoryLine category={sportCategory(team.league.sport)} size="sm" className="text-foreground" /> },
            { label: "Sport / Game", value: <SportLine sport={team.league.sport} /> },
            {
              label: "League",
              value: (
                <Link href={`/leagues/${team.league.id}`} className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">
                  {team.league.name}
                </Link>
              ),
            },
            { label: "Region", value: team.league.region },
            { label: "Season", value: team.league.season },
          ]}
        />
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="grid min-w-0 content-start gap-6 xl:col-span-2">
          <SectionCard
            title="Upcoming matches"
            description="Live and scheduled fixtures"
            href="/schedule"
            actionLabel="Schedule"
          >
            <MatchList
              matches={fixtures}
              now={now}
              emptyTitle="No upcoming matches"
              emptyDescription="Nothing is scheduled for this team right now."
            />
          </SectionCard>

          <SectionCard title="Recent results" description="Most recent first">
            <MatchList
              matches={results}
              now={now}
              emptyTitle="No results yet"
              emptyDescription="Finished matches will appear here."
            />
          </SectionCard>
        </div>

        <SectionCard
          title="Players"
          description={
            players.length > 0
              ? `${players.length} tracked ${players.length === 1 ? "player" : "players"}`
              : "Roster"
          }
          contentClassName="px-4"
          className="content-start"
        >
          {players.length > 0 ? (
            <ul className="grid gap-2 text-sm">
              {players.map((player) => (
                <li
                  key={player.id}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="grid min-w-0">
                    <span className="truncate font-medium">
                      {player.handle ?? player.name}
                    </span>
                    {player.handle ? (
                      <span className="truncate text-xs text-muted-foreground">
                        {player.name}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {player.role}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={UserRoundIcon}
              title="No players tracked"
              description="Player profiles for this team will appear here once available."
            />
          )}
        </SectionCard>
      </div>
    </>
  );
}
