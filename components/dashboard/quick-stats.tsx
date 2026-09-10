import { StarIcon, TrophyIcon, UserRoundIcon, UsersIcon } from "lucide-react"

import { StatCard } from "@/components/dashboard/stat-card"
import { getQuickStats } from "@/lib/data/queries"
import { sportLabel } from "@/lib/sports"

export async function QuickStats({ now }: { now: Date }) {
  const stats = await getQuickStats(now)

  const items = [
    {
      label: "Followed teams",
      value: stats.followedTeams,
      hint:
        stats.teamsPlayingToday > 0
          ? `${stats.teamsPlayingToday} playing today`
          : "None playing today",
      icon: UsersIcon,
      href: "/teams",
    },
    {
      label: "Followed players",
      value: stats.followedPlayers,
      hint: "Across your followed teams",
      icon: UserRoundIcon,
      href: "/players",
    },
    {
      label: "Followed leagues",
      value: stats.followedLeagues,
      hint: stats.followedSports.map(sportLabel).join(", "),
      icon: TrophyIcon,
      href: "/schedule",
    },
    {
      label: "Watchlist matches",
      value: stats.watchlistMatches,
      hint:
        stats.watchlistLive > 0
          ? `${stats.watchlistLive} live right now`
          : "None live right now",
      icon: StarIcon,
      href: "/watchlist",
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      {items.map((item) => (
        <StatCard key={item.label} {...item} />
      ))}
    </div>
  )
}
