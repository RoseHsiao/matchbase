import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { statusMeta, type AdminStatus, type StatusTone } from "@/lib/admin/status"

const toneClassName: Record<StatusTone, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  info: "bg-sky-500",
  neutral: "bg-muted-foreground/60",
}

/** Status pill with a coloured dot. Labels and tones come from `statusMeta`, or from an explicit `meta` (health pills). */
export function AdminStatusBadge({
  status,
  meta: explicit,
  className,
}: {
  status?: AdminStatus
  meta?: { label: string; tone: StatusTone }
  className?: string
}) {
  const meta = explicit ?? statusMeta[status ?? "active"]
  return (
    <Badge variant="outline" className={cn("gap-1.5", className)}>
      <span
        className={cn("size-1.5 shrink-0 rounded-full", toneClassName[meta.tone])}
        aria-hidden
      />
      {meta.label}
    </Badge>
  )
}
