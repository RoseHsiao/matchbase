import Link from "next/link"
import { ArrowRightIcon } from "lucide-react"

import { SectionCard } from "@/components/layout/section-card"
import { FollowedPlayerList } from "@/components/players/followed-player-list"
import { FollowedTeamList } from "@/components/teams/followed-team-list"
import { getPlayerViews, getTeamViews } from "@/lib/data/queries"

/**
 * Secondary panel: what the user follows, teams with their next fixture and
 * players with their team. Two labelled groups in one card, each with its
 * own link to the page where follows are managed.
 */
export async function Following({ now }: { now: Date }) {
  const [teams, players] = await Promise.all([getTeamViews(now), getPlayerViews()])

  return (
    <SectionCard title="Following" description="Teams and players you keep an eye on">
      <div className="grid gap-4">
        <FollowGroup title="Teams" href="/teams" headingId="following-teams">
          <FollowedTeamList teams={teams} now={now.toISOString()} />
        </FollowGroup>
        <FollowGroup title="Players" href="/players" headingId="following-players">
          <FollowedPlayerList players={players} />
        </FollowGroup>
      </div>
    </SectionCard>
  )
}

function FollowGroup({ title, href, headingId, children }: { title: string; href: string; headingId: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={headingId} className="grid gap-0.5">
      <div className="flex items-center justify-between px-3 pb-1">
        <h3 id={headingId} className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </h3>
        <Link
          href={href}
          className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          All {title.toLowerCase()}
          <ArrowRightIcon className="size-3" aria-hidden />
        </Link>
      </div>
      {children}
    </section>
  )
}
