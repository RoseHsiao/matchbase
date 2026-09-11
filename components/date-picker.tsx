"use client"

import * as React from "react"
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  addDays,
  dayKey,
  formatDate,
  formatDateTime,
  formatMonthYear,
  isSameDay,
  parseLocalDate,
  weekdayLabels,
} from "@/lib/format"

/**
 * Date pickers rendered in the app locale. Native date inputs follow the
 * operating system language, which made them disagree with the rest of the UI.
 */

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

type CalendarGridProps = {
  month: Date
  onMonthChange: (month: Date) => void
  selected?: Date
  onSelect: (date: Date) => void
}

function CalendarGrid({ month, onMonthChange, selected, onSelect }: CalendarGridProps) {
  const today = new Date()
  const first = startOfMonth(month)
  const gridStart = addDays(first, -first.getDay()) // Sunday-first week
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  const labels = weekdayLabels()

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Previous month"
          className="cursor-pointer"
          onClick={() => onMonthChange(addMonths(month, -1))}
        >
          <ChevronLeftIcon />
        </Button>
        <span className="text-sm font-medium" aria-live="polite">
          {formatMonthYear(first)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Next month"
          className="cursor-pointer"
          onClick={() => onMonthChange(addMonths(month, 1))}
        >
          <ChevronRightIcon />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {labels.map((label) => (
          <span key={label} className="py-1 text-[11px] font-medium text-muted-foreground">
            {label}
          </span>
        ))}
        {cells.map((date) => {
          const inMonth = date.getMonth() === first.getMonth()
          const isSelected = !!selected && isSameDay(date, selected)
          const isToday = isSameDay(date, today)
          return (
            <button
              key={dayKey(date)}
              type="button"
              aria-label={formatDate(date)}
              aria-pressed={isSelected}
              onClick={() => onSelect(date)}
              className={cn(
                "size-8 cursor-pointer rounded-md text-sm tabular-nums outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
                !inMonth && "text-muted-foreground/50",
                isToday && !isSelected && "font-semibold underline underline-offset-4",
                isSelected && "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              {date.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

type PickerTriggerProps = {
  id?: string
  label: string | undefined
  placeholder: string
}

function PickerTrigger({ id, label, placeholder }: PickerTriggerProps) {
  return (
    <PopoverTrigger
      render={
        <Button
          type="button"
          id={id}
          variant="outline"
          className={cn("w-full cursor-pointer justify-start font-normal", !label && "text-muted-foreground")}
        />
      }
    >
      <CalendarIcon data-icon="inline-start" className="text-muted-foreground" />
      {label ?? placeholder}
    </PopoverTrigger>
  )
}

type DatePickerProps = {
  id?: string
  /** "YYYY-MM-DD" or "". */
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function DatePicker({ id, value, onChange, placeholder = "Pick a date" }: DatePickerProps) {
  const selected = parseLocalDate(value)
  const [open, setOpen] = React.useState(false)
  const [month, setMonth] = React.useState(() => startOfMonth(selected ?? new Date()))

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setMonth(startOfMonth(selected ?? new Date()))
        setOpen(next)
      }}
    >
      <PickerTrigger id={id} label={selected ? formatDate(selected) : undefined} placeholder={placeholder} />
      <PopoverContent align="start" className="w-auto">
        <CalendarGrid
          month={month}
          onMonthChange={setMonth}
          selected={selected}
          onSelect={(date) => {
            onChange(dayKey(date))
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

const HOURS = Array.from({ length: 12 }, (_, i) => String(i === 0 ? 12 : i))
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"))
const PERIODS = ["AM", "PM"] as const

function splitTime(date: Date | undefined) {
  const hours24 = date?.getHours() ?? 12
  return {
    hour: String(hours24 % 12 === 0 ? 12 : hours24 % 12),
    minute: String(Math.floor((date?.getMinutes() ?? 0) / 5) * 5).padStart(2, "0"),
    period: hours24 >= 12 ? "PM" : "AM",
  }
}

function toHours24(hour: string, period: string): number {
  const h = Number(hour) % 12
  return period === "PM" ? h + 12 : h
}

type DateTimePickerProps = {
  id?: string
  /** "YYYY-MM-DDTHH:mm" or "". */
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function DateTimePicker({ id, value, onChange, placeholder = "Pick a date and time" }: DateTimePickerProps) {
  const selected = parseLocalDate(value)
  const [open, setOpen] = React.useState(false)
  const [month, setMonth] = React.useState(() => startOfMonth(selected ?? new Date()))
  const time = splitTime(selected)

  function commit(date: Date, hour: string, minute: string, period: string) {
    const pad = (n: number) => String(n).padStart(2, "0")
    onChange(`${dayKey(date)}T${pad(toHours24(hour, period))}:${minute}`)
  }

  const timeSelect = (
    idSuffix: string,
    ariaLabel: string,
    current: string,
    options: readonly string[],
    apply: (next: string) => void
  ) => (
    <Select
      value={current}
      items={Object.fromEntries(options.map((o) => [o, o]))}
      onValueChange={(next) => {
        if (typeof next === "string") apply(next)
      }}
    >
      <SelectTrigger
        id={id ? `${id}-${idSuffix}` : undefined}
        aria-label={ariaLabel}
        size="sm"
        className="min-w-16 cursor-pointer"
        disabled={!selected}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        {options.map((option) => (
          <SelectItem key={option} value={option} className="cursor-pointer">
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setMonth(startOfMonth(selected ?? new Date()))
        setOpen(next)
      }}
    >
      <PickerTrigger id={id} label={selected ? formatDateTime(selected) : undefined} placeholder={placeholder} />
      <PopoverContent align="start" className="w-auto">
        <CalendarGrid
          month={month}
          onMonthChange={setMonth}
          selected={selected}
          onSelect={(date) => commit(date, time.hour, time.minute, time.period)}
        />
        <div className="flex items-center justify-between gap-2 border-t pt-2">
          <div className="flex items-center gap-1">
            {timeSelect("hour", "Hour", time.hour, HOURS, (hour) => selected && commit(selected, hour, time.minute, time.period))}
            <span className="text-muted-foreground">:</span>
            {timeSelect("minute", "Minute", time.minute, MINUTES, (minute) => selected && commit(selected, time.hour, minute, time.period))}
            {timeSelect("period", "AM or PM", time.period, PERIODS, (period) => selected && commit(selected, time.hour, time.minute, period))}
          </div>
          <Button type="button" size="sm" className="cursor-pointer" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
