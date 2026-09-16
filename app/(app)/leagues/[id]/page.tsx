import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, UsersIcon } from "lucide-react";

import { AdminStatusBadge } from "@/components/admin/admin-status-badge";
import { DetailList } from "@/components/detail-list";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/layout/section-card";
import { CategoryLine, SportHierarchy, SportLine } from "@/components/sport-icon";
import { MatchList } from "@/components/matches/match-list";
import { TeamRow } from "@/components/teams/team-row";
import { buttonVariants } from "@/components/ui/button";
import {
  getLeagueById,
  getLeagueFixtures,
  getLeagueResults,
  getLeagueSeasons,
  getLeagueTeamViews,
} from "@/lib/data/queries";
import { formatDate } from "@/lib/format";
import { categoryLabel, sportCategory, sportLabel } from "@/lib/sports";

type LeaguePageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: LeaguePageProps): Promise<Metadata> {
  const { id } = await params;
  const league = await getLeagueById(id);
  return {
    title: league?.name ?? "League",
    description: league
      ? `${categoryLabel(sportCategory(league.sport))} · ${sportLabel(league.sport)} · ${league.region}`
      : undefined,
  };
}

export default async function LeaguePage({ params }: LeaguePageProps) {
  const { id } = await params;
  const league = await getLeagueById(id);
  if (!league) notFound();

  const now = new Date();
  const [seasons, teams, fixtures, results] = await Promise.all([
    getLeagueSeasons(league.id),
    getLeagueTeamViews(league.id, now),
    getLeagueFixtures(league.id, now),
    getLeagueResults(league.id, 10),
  ]);
  const category = sportCategory(league.sport);
  // The league record still carries a season label; the Season records are the
  // richer source, so prefer the current one and fall back to the label.
  const currentSeason = seasons.find((season) => season.status === "current") ?? seasons[0];
  const status = league.status ?? "active";

  return (
    <>
      <div className="grid gap-3">
        <Link
          href="/schedule"
          className={buttonVariants({ variant: "ghost", size: "sm", className: "w-fit -ml-2" })}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Schedule
        </Link>
        <PageHeader
          title={league.name}
          description={
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <SportHierarchy sport={league.sport} league={{ id: league.id, label: league.shortName }} />
              <span aria-hidden>·</span>
              <span>{league.region}</span>
            </span>
          }
          actions={<AdminStatusBadge status={status} />}
        />
      </div>

      <SectionCard title="League information" contentClassName="px-4">
        <DetailList
          items={[
            { label: "Category", value: <CategoryLine category={category} size="sm" className="text-foreground" /> },
            { label: "Sport / Game", value: <SportLine sport={league.sport} /> },
            { label: "Abbreviation", value: league.shortName },
            { label: "Region", value: league.region },
            { label: "Current season", value: currentSeason?.name ?? league.season },
            {
              label: "Season dates",
              value: currentSeason
                ? `${formatDate(currentSeason.startsAt)} – ${formatDate(currentSeason.endsAt)}`
                : "Not scheduled",
            },
            { label: "Status", value: <AdminStatusBadge status={status} /> },
            { label: "Teams", value: `${teams.length} ${teams.length === 1 ? "team" : "teams"}` },
          ]}
        />
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="grid min-w-0 content-start gap-6 xl:col-span-2">
          <SectionCard
            title="Upcoming matches"
            description="Live and scheduled fixtures in this league"
            href="/schedule"
            actionLabel="Schedule"
          >
            <MatchList
              matches={fixtures}
              now={now}
              showLeague={false}
              emptyTitle="No upcoming matches"
              emptyDescription={`Nothing is scheduled in the ${league.name} right now.`}
            />
          </SectionCard>

          <SectionCard
            title="Recent results"
            description="Most recent first"
            href="/history"
            actionLabel="History"
          >
            <MatchList
              matches={results}
              now={now}
              showLeague={false}
              emptyTitle="No results yet"
              emptyDescription={`Finished ${league.name} matches will appear here.`}
            />
          </SectionCard>
        </div>

        <div className="grid min-w-0 content-start gap-6">
          <SectionCard
            title="Teams"
            description={`${teams.length} ${teams.length === 1 ? "team" : "teams"} in the ${league.shortName}`}
            href="/teams"
            actionLabel="All teams"
          >
            {teams.length === 0 ? (
              <EmptyState
                icon={UsersIcon}
                title="No teams yet"
                description="Teams in this league will appear here."
                className="mx-2"
              />
            ) : (
              <ul className="grid gap-0.5">
                {teams.map((team) => (
                  <li key={team.id}>
                    <TeamRow team={team} now={now} />
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Seasons" description="Season windows for this league" contentClassName="px-4">
            {seasons.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No season records yet. Season label: {league.season}.
              </p>
            ) : (
              <ul className="grid gap-3 text-sm">
                {seasons.map((season) => (
                  <li key={season.id} className="flex items-center justify-between gap-3">
                    <span className="grid min-w-0 leading-tight">
                      <span className="truncate font-medium">{season.name}</span>
                      <span className="truncate text-xs text-muted-foreground tabular-nums">
                        {formatDate(season.startsAt)} – {formatDate(season.endsAt)}
                      </span>
                    </span>
                    <AdminStatusBadge status={season.status} />
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>
    </>
  );
}
