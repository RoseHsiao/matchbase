"use client"

import * as React from "react"
import Link from "next/link"
import { BellIcon } from "lucide-react"
import { cn } from "cn"

import { useViewer } from "@/components/auth/viewer-provider"
import { SportIcon } from "@/components/sport-icon"
import { Button, buttonVariants } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { useWatchlistReminders, type ReminderEntry } from "@/components/watchlist/watchlist-reminders-provider"
import { useWatchlist } from "@/components/watchlist/watchlist-provider"
import { formatKickoff } from "@/lib/format"
import { getReminderAt, isReminderAvailable, reminderLabel } from "@/lib/reminders"

const PREVIEW_LIMIT = 5

/**
 * Header bell: a subtle count of upcoming watched matches with a reminder,
 * and a popover listing the next few. This is the surface a future
 * notification service plugs into (docs/watchlist-reminders.md); nothing is
 * delivered today. Counting uses match status, not the clock, so the server
 * and client render the same number.
 */
export function ReminderIndicator({ className }: { className?: string }) {
  const viewer = useViewer()
  const { has } = useWatchlist()
  const { entries } = useWatchlistReminders()
  const [open, setOpen] = React.useState(false)
  const pending = React.useMemo(
    () =>
      [...entries.values()]
        .filter((entry) => has(entry.matchId) && entry.reminder !== "off" && isReminderAvailable(entry.status))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [entries, has]
  )
  const count = pending.length
  const label = count === 0 ? "Reminders: none set" : `Reminders: ${count} upcoming`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon-sm" className={cn("relative", className)} aria-label={label} title={label} />}
      >
        <BellIcon />
        {count > 0 ? (
          <span
            aria-hidden
            className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground tabular-nums"
          >
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <PopoverHeader className="px-4 pt-4 pb-2">
          <PopoverTitle>Reminders</PopoverTitle>
          <PopoverDescription>
            {!viewer
              ? "Sign in to save matches and choose when to be reminded."
              : count === 0
                ? "Add a match to your Watchlist and choose when to be reminded; it will show up here."
                : `${count} upcoming ${count === 1 ? "match" : "matches"} with a reminder. Nothing is sent yet; this is where your reminders are set.`}
          </PopoverDescription>
        </PopoverHeader>
        {count > 0 ? (
          <ul className="grid gap-0.5 px-2 pb-2">
            {pending.slice(0, PREVIEW_LIMIT).map((entry) => (
              <li key={entry.matchId}>
                <ReminderRow entry={entry} onNavigate={() => setOpen(false)} />
              </li>
            ))}
          </ul>
        ) : null}
        <div className="border-t px-4 py-2">
          <Link href={viewer ? "/watchlist" : "/sign-in?next=%2Fwatchlist"} onClick={() => setOpen(false)} className={buttonVariants({ variant: "ghost", size: "sm", className: "w-full justify-center" })}>
            {viewer ? "Open Watchlist" : "Sign in"}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ReminderRow({ entry, onNavigate }: { entry: ReminderEntry; onNavigate: () => void }) {
  const firesAt = getReminderAt(entry.startsAt, entry.reminder)
  return (
    <Link
      href={`/matches/${entry.matchId}`}
      onClick={onNavigate}
      className="grid gap-0.5 rounded-md px-2 py-1.5 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span className="flex items-center gap-1.5 text-sm">
        <SportIcon sport={entry.sport} size="sm" className="text-muted-foreground" />
        <span className="truncate font-medium">{entry.title}</span>
      </span>
      <span className="pl-5.5 text-xs text-muted-foreground">
        {entry.leagueShortName} · {formatKickoff(entry.startsAt)} · {reminderLabel(entry.reminder)}
        {firesAt ? ` (${formatKickoff(firesAt)})` : ""}
      </span>
    </Link>
  )
}
