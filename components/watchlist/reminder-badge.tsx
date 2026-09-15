"use client"

import { BellRingIcon } from "lucide-react"
import { cn } from "cn"

import { useWatchlistReminders } from "@/components/watchlist/watchlist-reminders-provider"
import { useWatchlist } from "@/components/watchlist/watchlist-provider"
import type { MatchView } from "@/lib/data/types"
import { formatTime, isSameDay } from "@/lib/format"
import { getReminderAt, isReminderAvailable, reminderLabel } from "@/lib/reminders"

type ReminderBadgeProps = {
  match: Pick<MatchView, "id" | "startsAt" | "status">
  /** Also show the time the reminder fires, when it is on the match day. */
  showTime?: boolean
  className?: string
}

/**
 * Read-only "15 min before · 7:15 PM" line for lists. Renders nothing when
 * the match is not saved, has no reminder, or has already started.
 */
export function ReminderBadge({ match, showTime = true, className }: ReminderBadgeProps) {
  const { has } = useWatchlist()
  const { entries } = useWatchlistReminders()
  const entry = entries.get(match.id)
  if (!has(match.id) || !entry || entry.reminder === "off" || !isReminderAvailable(match.status)) return null
  const firesAt = getReminderAt(match.startsAt, entry.reminder)
  const time = showTime && firesAt && isSameDay(firesAt, match.startsAt) ? ` · ${formatTime(firesAt)}` : ""
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}>
      <BellRingIcon className="size-3" aria-hidden />
      <span>
        <span className="sr-only">Reminder </span>
        {reminderLabel(entry.reminder)}
        {time}
      </span>
    </span>
  )
}
