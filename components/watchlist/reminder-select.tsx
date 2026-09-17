"use client"

import * as React from "react"
import { BellIcon, BellOffIcon, BellRingIcon } from "lucide-react"
import { cn } from "cn"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useMatchReminder } from "@/components/watchlist/watchlist-reminders-provider"
import { useWatchlist } from "@/components/watchlist/watchlist-provider"
import type { MatchView, WatchlistReminder } from "@/lib/data/types"
import { formatKickoff } from "@/lib/format"
import { matchTitle } from "@/lib/matches"
import { REMINDER_OPTIONS, getReminderAt, reminderLabel } from "@/lib/reminders"

type ReminderSelectProps = {
  match: MatchView
  /** Reference time for the "fires at" hint. */
  now?: Date
  /** Row variant: icon-only trigger with a short value, no caption. */
  compact?: boolean
  className?: string
}

/** Trigger labels: the chosen timing, or "No reminder" for off. The menu still offers "Off". */
const items = Object.fromEntries(REMINDER_OPTIONS.map((option) => [option.value, option.value === "off" ? "No reminder" : option.label]))

/**
 * Reminder picker for a watchlisted match. Enabled only while the match is
 * saved and has not started; otherwise it stays visible but disabled with a
 * short reason, so the user learns why rather than hunting for the control.
 */
export function ReminderSelect({ match, now, compact = false, className }: ReminderSelectProps) {
  const { has } = useWatchlist()
  const watchlisted = has(match.id)
  const { reminder, available, reason, setReminder } = useMatchReminder(
    { id: match.id, title: matchTitle(match), startsAt: match.startsAt, status: match.status, leagueShortName: match.league.shortName, sport: match.league.sport },
    watchlisted
  )
  const [error, setError] = React.useState<string | null>(null)
  const firesAt = available ? getReminderAt(match.startsAt, reminder) : null
  const hint = !available
    ? reason === "not-watchlisted"
      ? "Add to Watchlist first, then choose when to be reminded."
      : reason === "started"
        ? "The match has already started, so no reminder can be set."
        : "The match has finished, so no reminder can be set."
    : firesAt
      ? `Reminder at ${formatKickoff(firesAt, now)}`
      : "Saved. Choose when to be reminded before the start."
  const Icon = !available ? BellOffIcon : reminder === "off" ? BellIcon : BellRingIcon

  async function onChange(next: WatchlistReminder) {
    setError(null)
    const result = await setReminder(next)
    if (!result.ok) setError(result.error)
  }

  const select = (
    <Select
      value={reminder}
      items={items}
      disabled={!available}
      onValueChange={(next) => {
        if (typeof next === "string" && next in items) void onChange(next as WatchlistReminder)
      }}
    >
      <SelectTrigger
        id={compact ? `reminder-${match.id}` : "match-reminder"}
        size="sm"
        aria-label={compact ? `Reminder: ${reminderLabel(reminder)}` : undefined}
        title={compact ? hint : undefined}
        className={cn("cursor-pointer", compact ? "max-w-40 gap-1 text-xs max-sm:px-2" : "min-w-40")}
      >
        <Icon className={cn("text-muted-foreground", available && reminder !== "off" && "text-foreground")} aria-hidden />
        {/* Phones show the bell only; the trigger's aria-label carries the value. */}
        <SelectValue className={cn(compact && "max-sm:sr-only")} />
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false}>
        {REMINDER_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value} className="cursor-pointer">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  if (compact) {
    return (
      <div className={cn("grid justify-items-end gap-0.5", className)}>
        {select}
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      </div>
    )
  }

  return (
    <div className={cn("grid gap-1", className)}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Reminder</span>
        {select}
      </div>
      <p className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")} role={error ? "alert" : undefined} aria-live="polite">
        {error ?? hint}
      </p>
    </div>
  )
}
