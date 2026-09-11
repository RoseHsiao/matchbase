"use client"

import { cn } from "cn"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { dayDifference, formatShortDate, formatWeekday } from "@/lib/format"

export type DateStripDay = {
  /** Local day key, see `dayKey`. */
  key: string
  date: Date
  /** Matches on this day after non-date filters. */
  count: number
}

type DateStripProps = {
  days: DateStripDay[]
  /** Selected day key, or `allValue` for every day. */
  selected: string
  onSelect: (key: string) => void
  now: Date
  allValue: string
  allCount: number
  className?: string
}

const itemClassName =
  "h-auto min-w-18 cursor-pointer flex-col gap-0 px-3 py-1.5 leading-tight snap-start aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/90"

function weekdayLabel(date: Date, now: Date): string {
  const diff = dayDifference(now, date)
  if (diff === 0) return "Today"
  if (diff === 1) return "Tomorrow"
  return formatWeekday(date)
}

/** Horizontal day picker. Scrolls on narrow screens. */
export function DateStrip({
  days,
  selected,
  onSelect,
  now,
  allValue,
  allCount,
  className,
}: DateStripProps) {
  return (
    <ToggleGroup
      aria-label="Choose a day"
      variant="outline"
      value={[selected]}
      onValueChange={(value) => {
        // Single-select group: ignore the deselect click so a day stays chosen.
        const next = value[0]
        if (typeof next === "string") onSelect(next)
      }}
      className={cn(
        "w-full max-w-full snap-x overflow-x-auto pb-1 [scrollbar-width:thin]",
        className
      )}
    >
      <ToggleGroupItem value={allValue} className={itemClassName}>
        <span className="text-xs opacity-70">All</span>
        <span className="text-sm font-semibold">{days.length} days</span>
        <span className="text-[11px] opacity-70">{countLabel(allCount)}</span>
      </ToggleGroupItem>
      {days.map((day) => (
        <ToggleGroupItem key={day.key} value={day.key} className={itemClassName}>
          <span className="text-xs opacity-70">{weekdayLabel(day.date, now)}</span>
          <span className="text-sm font-semibold">{formatShortDate(day.date)}</span>
          <span className="text-[11px] opacity-70">{countLabel(day.count)}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

function countLabel(count: number): string {
  if (count === 0) return "No matches"
  return `${count} ${count === 1 ? "match" : "matches"}`
}
