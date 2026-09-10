import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import type { MatchStatus } from "@/lib/data/types"

/** Text colour shared by every "live" indicator. */
export const liveTextClassName = "text-red-600 dark:text-red-400"

/** Pulsing dot used next to live labels. Decorative. */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative flex size-1.5", className)} aria-hidden>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-75 motion-reduce:animate-none" />
      <span className="relative inline-flex size-1.5 rounded-full bg-current" />
    </span>
  )
}

type MatchStatusBadgeProps = {
  status: MatchStatus
  /** Live-only detail such as "67'" or "Map 2". */
  liveDetail?: string
  className?: string
}

export function MatchStatusBadge({
  status,
  liveDetail,
  className,
}: MatchStatusBadgeProps) {
  if (status === "live") {
    return (
      <Badge
        className={cn(
          "border-red-500/20 bg-red-500/10",
          liveTextClassName,
          className
        )}
      >
        <LiveDot />
        Live{liveDetail ? ` · ${liveDetail}` : ""}
      </Badge>
    )
  }

  if (status === "finished") {
    return (
      <Badge variant="secondary" className={className}>
        Final
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className={className}>
      Upcoming
    </Badge>
  )
}
