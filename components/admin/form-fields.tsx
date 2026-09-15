"use client"

import { cn } from "cn"

import { DatePicker, DateTimePicker } from "@/components/date-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type BaseFieldProps = {
  id: string
  label: string
  /** Span both columns of the form grid. */
  full?: boolean
  hint?: string
}

function Field({ id, label, full, hint, children }: BaseFieldProps & { children: React.ReactNode }) {
  return (
    <div className={cn("grid gap-1.5", full && "sm:col-span-2")}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function TextField({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
  full,
  hint,
}: BaseFieldProps & {
  value: string
  onChange: (value: string) => void
  type?: "text" | "color"
  placeholder?: string
  required?: boolean
}) {
  return (
    <Field id={id} label={label} full={full} hint={hint}>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

/** Calendar-based date field ("YYYY-MM-DD"), rendered in the app locale. */
export function DateField({
  id,
  label,
  value,
  onChange,
  full,
  hint,
}: BaseFieldProps & { value: string; onChange: (value: string) => void }) {
  return (
    <Field id={id} label={label} full={full} hint={hint}>
      <DatePicker id={id} value={value} onChange={onChange} />
    </Field>
  )
}

/** Calendar plus time field ("YYYY-MM-DDTHH:mm"), rendered in the app locale. */
export function DateTimeField({
  id,
  label,
  value,
  onChange,
  full,
  hint,
}: BaseFieldProps & { value: string; onChange: (value: string) => void }) {
  return (
    <Field id={id} label={label} full={full} hint={hint}>
      <DateTimePicker id={id} value={value} onChange={onChange} />
    </Field>
  )
}

export function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  full,
  hint,
}: BaseFieldProps & {
  value: number | ""
  onChange: (value: number | "") => void
  min?: number
}) {
  return (
    <Field id={id} label={label} full={full} hint={hint}>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        value={value}
        onChange={(event) =>
          onChange(event.target.value === "" ? "" : Number(event.target.value))
        }
      />
    </Field>
  )
}

export function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  placeholder = "Select…",
  full,
  hint,
  hideLabel,
}: BaseFieldProps & {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  /** Keep the label for assistive technology only, e.g. in a repeated row with a shared heading. */
  hideLabel?: boolean
}) {
  const items = Object.fromEntries(options.map((option) => [option.value, option.label]))
  const select = (
      <Select
        value={value || null}
        items={items}
        onValueChange={(next) => {
          if (typeof next === "string") onChange(next)
        }}
      >
        <SelectTrigger id={id} className="w-full cursor-pointer" aria-label={hideLabel ? label : undefined}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false}>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} className="cursor-pointer">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
  )
  if (hideLabel) return select
  return (
    <Field id={id} label={label} full={full} hint={hint}>
      {select}
    </Field>
  )
}
