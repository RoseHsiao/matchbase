"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export const ALL = "all"

type FilterFieldProps = {
  id: string
  label: string
  children: React.ReactNode
}

/**
 * Label above a control. Every filter uses it so labels, gaps, and control
 * heights line up across a toolbar. The label id is `${id}-label`.
 */
export function FilterField({ id, label, children }: FilterFieldProps) {
  return (
    <div className="grid min-w-0 gap-1">
      <span id={`${id}-label`} className="text-xs font-medium text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  )
}

type FilterSelectProps = {
  id: string
  label: string
  /** Label for the "no filter" option. */
  allLabel: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  className?: string
}

/** Labelled single-select filter with an "All" option. Opens below the trigger. */
export function FilterSelect({
  id,
  label,
  allLabel,
  value,
  onChange,
  options,
  className,
}: FilterSelectProps) {
  const items = {
    [ALL]: allLabel,
    ...Object.fromEntries(options.map((option) => [option.value, option.label])),
  }

  return (
    <FilterField id={id} label={label}>
      <Select
        value={value}
        items={items}
        onValueChange={(next) => {
          if (typeof next === "string") onChange(next)
        }}
      >
        <SelectTrigger
          aria-labelledby={`${id}-label`}
          className={className ?? "w-full cursor-pointer lg:w-44"}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false}>
          <SelectItem value={ALL} className="cursor-pointer">
            {allLabel}
          </SelectItem>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="cursor-pointer"
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FilterField>
  )
}
