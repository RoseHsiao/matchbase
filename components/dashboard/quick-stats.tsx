import { TrophyIcon, UserRoundIcon } from "lucide-react"

import { StatCard } from "@/components/dashboard/stat-card"
import { FollowedTeamsStatCard } from "@/components/teams/followed-teams-stat-card"
import { WatchlistStatCard } from "@/components/watchlist/watchlist-stat-card"
import { getMatches, getQuickStats, getTeamViews } from "@/lib/data/queries"
import { sportLabel } from "@/lib/sports"

export async function QuickStats({ now }: { now: Date }) {
  const [stats, matches, teams] = await Promise.all([
    getQuickStats(),
    getMatches(),
    getTeamViews(now),
  ])

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <FollowedTeamsStatCard
        teams={teams}
        matches={matches}
        now={now.toISOString()}
      />
      <StatCard
        label="Followed players"
        value={stats.followedPlayers}
        hint="Across your followed teams"
        icon={UserRoundIcon}
        href="/players"
      />
      <StatCard
        label="Followed leagues"
        value={stats.followedLeagues}
        hint={stats.followedSports.map(sportLabel).join(", ")}
        icon={TrophyIcon}
        href="/schedule"
      />
      <WatchlistStatCard matches={matches} />
    </div>
  )
}
