"use client"

import { BellOffIcon, BellRingIcon } from "lucide-react"
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
  /** Spell out "No reminder" for a saved upcoming match without one, so the two states differ by text and icon. */
  showOff?: boolean
  className?: string
}

/**
 * Read-only "15 min before · 7:15 PM" line for lists. Renders nothing when
 * the match is not saved or has already started; without `showOff` it also
 * renders nothing when no reminder is set.
 */
export function ReminderBadge({ match, showTime = true, showOff = false, className }: ReminderBadgeProps) {
  const { has } = useWatchlist()
  const { entries } = useWatchlistReminders()
  const entry = entries.get(match.id)
  if (!has(match.id) || !isReminderAvailable(match.status)) return null
  if (!entry || entry.reminder === "off") {
    if (!showOff) return null
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}>
        <BellOffIcon className="size-3" aria-hidden />
        No reminder
      </span>
    )
  }
  const firesAt = getReminderAt(match.startsAt, entry.reminder)
  const time = showTime && firesAt && isSameDay(firesAt, match.startsAt) ? ` · ${formatTime(firesAt)}` : ""
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}>
      <BellRingIcon className="size-3" aria-hidden />
      <span>
        <span className="sr-only">Reminder </span>
        {reminderLabel(entry.reminder)}
        {/* The fire time is a nicety; phones keep the column narrow so participant names stay readable. */}
        {time ? <span className="hidden sm:inline">{time}</span> : null}
      </span>
    </span>
  )
}
