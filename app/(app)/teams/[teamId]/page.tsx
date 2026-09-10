import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckIcon } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/layout/section-card";
import { MatchList } from "@/components/matches/match-list";
import { TeamLogo } from "@/components/matches/team-logo";
import { Badge } from "@/components/ui/badge";
import {
  getTeamById,
  getTeamMatches,
  getTeamPlayers,
  isTeamFollowed,
} from "@/lib/data/queries";

type TeamPageProps = {
  params: Promise<{ teamId: string }>;
};

export async function generateMetadata({
  params,
}: TeamPageProps): Promise<Metadata> {
  const { teamId } = await params;
  const team = await getTeamById(teamId);
  return { title: team?.name ?? "Team" };
}

export default async function TeamPage({ params }: TeamPageProps) {
  const { teamId } = await params;
  const team = await getTeamById(teamId);
  if (!team) notFound();

  const [matches, players, followed] = await Promise.all([
    getTeamMatches(team.id),
    getTeamPlayers(team.id),
    isTeamFollowed(team.id),
  ]);
  const now = new Date();

  return (
    <>
      <div className="flex items-start gap-4">
        <TeamLogo team={team} size="xl" />
        <PageHeader
          className="flex-1"
          title={team.name}
          description={`${team.league.name} · ${team.league.region}`}
          actions={
            followed ? (
              <Badge variant="secondary">
                <CheckIcon data-icon="inline-start" />
                Following
              </Badge>
            ) : null
          }
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <SectionCard
          title="Fixtures and results"
          description="All matches on record for this team"
          className="xl:col-span-2"
        >
          <MatchList
            matches={matches}
            now={now}
            emptyTitle="No matches on record"
          />
        </SectionCard>

        <SectionCard
          title="Roster"
          description={
            players.length > 0
              ? `${players.length} tracked ${players.length === 1 ? "player" : "players"}`
              : "No players tracked yet"
          }
          contentClassName="px-4"
        >
          {players.length > 0 ? (
            <ul className="grid gap-2 text-sm">
              {players.map((player) => (
                <li
                  key={player.id}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="truncate font-medium">
                    {player.handle ?? player.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {player.role}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Roster data will appear here once available.
            </p>
          )}
        </SectionCard>
      </div>
    </>
  );
}
