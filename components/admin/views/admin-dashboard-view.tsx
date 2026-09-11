"use client"

import Link from "next/link"
import {
  ActivityIcon,
  AwardIcon,
  CalendarRangeIcon,
  DatabaseIcon,
  RefreshCwIcon,
  SwordsIcon,
  TrophyIcon,
  UserRoundIcon,
  UsersIcon,
} from "lucide-react"

import { useAdminCollection, useAdminLookups, useAdminNow } from "@/components/admin/admin-data-provider"
import { AdminPage } from "@/components/admin/admin-page"
import { AdminStatusBadge } from "@/components/admin/admin-status-badge"
import { StatCard } from "@/components/dashboard/stat-card"
import { EmptyState } from "@/components/empty-state"
import { SectionCard } from "@/components/layout/section-card"
import { buttonVariants } from "@/components/ui/button"
import { formatRelativeTime } from "@/lib/format"

export function AdminDashboardView() {
  const now = useAdminNow()
  const { items: sports } = useAdminCollection("sports")
  const { items: leagues } = useAdminCollection("leagues")
  const { items: seasons } = useAdminCollection("seasons")
  const { items: teams } = useAdminCollection("teams")
  const { items: players } = useAdminCollection("players")
  const { items: matches } = useAdminCollection("matches")
  const { items: dataSources } = useAdminCollection("dataSources")
  const { items: syncLogs } = useAdminCollection("syncLogs")
  const { items: activity } = useAdminCollection("activity")
  const { dataSourceById } = useAdminLookups()

  const activeLeagues = leagues.filter((league) => (league.status ?? "active") === "active").length
  const upcoming = matches.filter((match) => match.status === "upcoming").length
  const live = matches.filter((match) => match.status === "live").length
  const connected = dataSources.filter((source) => source.status === "connected").length
  const attention = dataSources.filter((source) => source.status !== "connected").length
  const recentLogs = [...syncLogs].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5)
  const lastSync = recentLogs[0]
  const recentActivity = [...activity].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6)

  const stats = [
    { label: "Sports / Games", value: sports.length, icon: TrophyIcon, href: "/admin/sports" },
    { label: "Leagues", value: leagues.length, icon: AwardIcon, href: "/admin/leagues" },
    { label: "Seasons", value: seasons.length, icon: CalendarRangeIcon, href: "/admin/seasons" },
    { label: "Teams", value: teams.length, icon: UsersIcon, href: "/admin/teams" },
    { label: "Players", value: players.length, icon: UserRoundIcon, href: "/admin/players" },
    { label: "Matches", value: matches.length, icon: SwordsIcon, href: "/admin/matches" },
  ]

  return (
    <AdminPage
      title="Admin"
      description="Manage the catalogue behind MatchBase: sports and games, leagues, seasons, teams, players, matches, and the feeds that keep them current."
    >
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Active leagues"
          value={activeLeagues}
          hint={`of ${leagues.length} total`}
          icon={AwardIcon}
          href="/admin/leagues"
        />
        <StatCard
          label="Upcoming matches"
          value={upcoming}
          hint={live > 0 ? `${live} live right now` : "None live right now"}
          icon={SwordsIcon}
          href="/admin/matches"
        />
        <StatCard
          label="Last sync"
          value={lastSync ? formatRelativeTime(lastSync.at, now) : "Never"}
          hint={
            lastSync
              ? `${dataSourceById.get(lastSync.dataSourceId)?.name ?? "Unknown source"} · ${lastSync.status}`
              : "No sync runs recorded"
          }
          icon={RefreshCwIcon}
          href="/admin/sync-logs"
        />
        <StatCard
          label="Data sources"
          value={`${connected}/${dataSources.length}`}
          hint={attention > 0 ? `${attention} need attention` : "All connected"}
          icon={DatabaseIcon}
          href="/admin/data-sources"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Recent activity" description="Latest administrative changes" contentClassName="px-4">
          {recentActivity.length === 0 ? (
            <EmptyState icon={ActivityIcon} title="No activity yet" />
          ) : (
            <ul className="grid gap-3 text-sm">
              {recentActivity.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-3">
                  <span className="grid min-w-0">
                    <span className="truncate">
                      <span className="font-medium">{entry.action}</span>
                      <span className="text-muted-foreground"> · {entry.entity}</span>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{entry.actor}</span>
                  </span>
                  <time dateTime={entry.at} className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatRelativeTime(entry.at, now)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Recent syncs"
          description="Latest synchronisation runs"
          href="/admin/sync-logs"
          actionLabel="All logs"
          contentClassName="px-4"
        >
          {recentLogs.length === 0 ? (
            <EmptyState
              icon={RefreshCwIcon}
              title="No sync runs yet"
              action={
                <Link href="/admin/data-sources" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  Data sources
                </Link>
              }
            />
          ) : (
            <ul className="grid gap-3 text-sm">
              {recentLogs.map((log) => (
                <li key={log.id} className="flex items-center justify-between gap-3">
                  <span className="grid min-w-0">
                    <span className="truncate font-medium">
                      {dataSourceById.get(log.dataSourceId)?.name ?? "Unknown source"}
                    </span>
                    <span className="truncate text-xs text-muted-foreground capitalize">
                      {log.entity} · {log.records} records · {formatRelativeTime(log.at, now)}
                    </span>
                  </span>
                  <AdminStatusBadge status={log.status} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </AdminPage>
  )
}
