import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { DetailList } from "@/components/detail-list";
import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/layout/section-card";
import { MatchList } from "@/components/matches/match-list";
import { MatchScoreboard } from "@/components/matches/match-scoreboard";
import { MatchStatusBadge } from "@/components/matches/match-status-badge";
import { SportLine } from "@/components/sport-icon";
import { ReminderSelect } from "@/components/watchlist/reminder-select";
import { WatchlistButton } from "@/components/watchlist/watchlist-button";
import { buttonVariants } from "@/components/ui/button";
import { getMatchById, getRelatedMatches } from "@/lib/data/queries";
import { formatKickoff, formatLongDate, formatTime } from "@/lib/format";
import { matchTitle } from "@/lib/matches";
import { categoryLabel, sportCategory, sportLabel } from "@/lib/sports";

type MatchPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: MatchPageProps): Promise<Metadata> {
  const { id } = await params;
  const match = await getMatchById(id);
  return {
    title: match ? matchTitle(match, "short") : "Match",
    description: match
      ? `${match.league.name} · ${formatKickoff(match.startsAt)}`
      : undefined,
  };
}

export default async function MatchPage({ params }: MatchPageProps) {
  const { id } = await params;
  const match = await getMatchById(id);
  if (!match) notFound();

  const now = new Date();
  const related = await getRelatedMatches(match, 4, now);

  const { league } = match;
  const statusLabel =
    match.status === "live"
      ? "Live"
      : match.status === "finished"
        ? "Finished"
        : "Upcoming";

  return (
    <>
      <div className="grid gap-3">
        <Link
          href="/schedule"
          className={buttonVariants({
            variant: "ghost",
            size: "sm",
            className: "w-fit -ml-2",
          })}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Back to schedule
        </Link>
        <PageHeader
          title={matchTitle(match)}
          description={[
            categoryLabel(sportCategory(league.sport)),
            sportLabel(league.sport),
            league.name,
            league.season,
            formatKickoff(match.startsAt, now),
          ].join(" · ")}
          actions={
            <div className="grid justify-items-start gap-2 sm:justify-items-end">
              <WatchlistButton matchId={match.id} status={match.status} />
              <ReminderSelect match={match} now={now} />
            </div>
          }
        />
      </div>

      <MatchScoreboard match={match} now={now} />

      <SectionCard
        title="Match information"
        description={
          match.status === "upcoming"
            ? "Everything you need before the match starts."
            : match.status === "live"
              ? "This match is in progress."
              : "Final details for this match."
        }
        contentClassName="px-4"
      >
        <DetailList
          items={[
            { label: "Category", value: categoryLabel(sportCategory(league.sport)) },
            { label: "Sport / Game", value: <SportLine sport={league.sport} /> },
            {
              label: "Competition",
              value: (
                <Link href={`/leagues/${league.id}`} className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">
                  {league.name}
                </Link>
              ),
            },
            { label: "Venue", value: match.venue ?? "To be announced" },
            { label: "Season", value: league.season },
            {
              label: "Status",
              value: (
                <span className="inline-flex items-center gap-2">
                  <MatchStatusBadge
                    status={match.status}
                    liveDetail={match.liveDetail}
                  />
                  <span className="sr-only">{statusLabel}</span>
                </span>
              ),
            },
            {
              label: "Scheduled start",
              value: (
                <time dateTime={match.startsAt}>
                  {formatLongDate(match.startsAt)} · {formatTime(match.startsAt)}
                </time>
              ),
            },
            { label: "Stage", value: match.stage ?? "Regular season" },
          ]}
        />
      </SectionCard>

      <SectionCard
        title={`More from ${league.shortName}`}
        description={`Upcoming ${league.name} matches`}
        href={`/leagues/${league.id}`}
        actionLabel="League page"
      >
        <MatchList
          matches={related}
          now={now}
          showLeague={false}
          emptyTitle="No other upcoming matches"
          emptyDescription={`Nothing else is scheduled in the ${league.name} right now.`}
        />
      </SectionCard>
    </>
  );
}
