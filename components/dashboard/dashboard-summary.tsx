"use client"

import Link from "next/link"
import { BellRingIcon, StarIcon, UsersIcon, type LucideIcon } from "lucide-react"

import { useViewer } from "@/components/auth/viewer-provider"
import { usePlayerFollows } from "@/components/players/player-follows-provider"
import { useFollows } from "@/components/teams/follows-provider"
import { useWatchlist } from "@/components/watchlist/watchlist-provider"
import { useWatchlistReminders } from "@/components/watchlist/watchlist-reminders-provider"
import { isReminderAvailable } from "@/lib/reminders"

type DashboardSummaryProps = {
  /** Followed leagues, counted on the server (no client store for league follows). */
  followedLeagues: number
  /** Matches on today's list, counted on the server. */
  todayCount: number
  liveCount: number
}

function plural(count: number, noun: string, nounPlural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : nounPlural}`
}

/**
 * One compact strip that reads as the product loop, Follow → Watchlist →
 * Reminder, with live counts from the shared client stores. Each segment
 * links to the page where the user acts on it. Counts derive from status,
 * never from the clock, so the server and client render the same numbers.
 */
export function DashboardSummary({ followedLeagues, todayCount, liveCount }: DashboardSummaryProps) {
  const viewer = useViewer()
  const teams = useFollows().count
  const players = usePlayerFollows().count
  const { ids: watchlist } = useWatchlist()
  const { entries } = useWatchlistReminders()
  const saved = [...entries.values()].filter((entry) => watchlist.has(entry.matchId))
  const upcoming = saved.filter((entry) => isReminderAvailable(entry.status))
  const withReminder = upcoming.filter((entry) => entry.reminder !== "off").length

  const segments: { icon: LucideIcon; label: string; value: string; hint: string; href: string }[] = [
    {
      icon: UsersIcon,
      label: "Following",
      value: viewer ? [plural(teams, "team"), plural(players, "player"), plural(followedLeagues, "league")].join(" · ") : "Sign in to follow",
      hint: todayCount > 0 ? `${plural(todayCount, "match", "matches")} today${liveCount > 0 ? `, ${liveCount} live` : ""}` : "Nothing today",
      href: viewer ? "/teams" : "/sign-in?next=%2Fdashboard",
    },
    {
      icon: StarIcon,
      label: "Watchlist",
      value: viewer ? plural(watchlist.size, "saved match", "saved matches") : "Sign in to save matches",
      hint: upcoming.length > 0 ? `${upcoming.length} still to come` : watchlist.size > 0 ? "Nothing upcoming" : "Save matches from the schedule",
      href: viewer ? "/watchlist" : "/sign-in?next=%2Fdashboard",
    },
    {
      icon: BellRingIcon,
      label: "Reminders",
      value: viewer ? plural(withReminder, "reminder") : "Sign in to set reminders",
      hint: upcoming.length > withReminder ? `${upcoming.length - withReminder} saved without one` : withReminder > 0 ? "Every upcoming saved match covered" : "Set them on a saved match",
      href: viewer ? "/watchlist" : "/sign-in?next=%2Fdashboard",
    },
  ]

  return (
    <nav aria-label="At a glance" className="grid overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 sm:grid-cols-3">
      {segments.map((segment) => (
        <Link
          key={segment.label}
          href={segment.href}
          className="flex min-w-0 items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset max-sm:border-b max-sm:last:border-b-0 sm:border-r sm:last:border-r-0"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <segment.icon className="size-4" aria-hidden />
          </span>
          <span className="grid min-w-0 leading-tight">
            <span className="text-xs text-muted-foreground">{segment.label}</span>
            <span className="truncate text-sm font-medium tabular-nums">{segment.value}</span>
            <span className="truncate text-xs text-muted-foreground">{segment.hint}</span>
          </span>
        </Link>
      ))}
    </nav>
  )
}
