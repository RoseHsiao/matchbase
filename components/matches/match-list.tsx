import { CalendarXIcon } from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { MatchRow } from "@/components/matches/match-row"
import type { MatchStatus, MatchView } from "@/lib/data/types"

type RowOptions = {
  now?: Date
  showLeague?: boolean
  showDay?: boolean
  compact?: boolean
  showCategory?: boolean
  /** Per-row control rendered beside the link, e.g. a watchlist toggle. */
  renderAction?: (match: MatchView) => React.ReactNode
}

type MatchListProps = RowOptions & {
  matches: MatchView[]
  /** Split the list into Live, Upcoming, and Finished groups with labels. */
  groupByStatus?: boolean
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: React.ReactNode
}

const GROUPS: { status: MatchStatus; label: string }[] = [
  { status: "live", label: "Live now" },
  { status: "upcoming", label: "Upcoming" },
  { status: "finished", label: "Finished" },
]

export function MatchList({
  matches,
  groupByStatus = false,
  emptyTitle = "No matches",
  emptyDescription,
  emptyAction,
  ...rowOptions
}: MatchListProps) {
  if (matches.length === 0) {
    return (
      <EmptyState
        icon={CalendarXIcon}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
        className="mx-2"
      />
    )
  }

  if (!groupByStatus) {
    return <Rows matches={matches} {...rowOptions} />
  }

  return (
    <div className="grid gap-3">
      {GROUPS.map(({ status, label }) => {
        const group = matches.filter((match) => match.status === status)
        if (group.length === 0) return null
        const headingId = `match-group-${status}`
        return (
          <section key={status} aria-labelledby={headingId} className="grid gap-0.5">
            <h3
              id={headingId}
              className="px-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              {label}
              <span className="ml-1.5 tabular-nums normal-case">
                {group.length}
              </span>
            </h3>
            <Rows matches={group} {...rowOptions} />
          </section>
        )
      })}
    </div>
  )
}

function Rows({
  matches,
  renderAction,
  ...rowOptions
}: RowOptions & { matches: MatchView[] }) {
  return (
    <ul className="grid gap-0.5">
      {matches.map((match) => (
        <li key={match.id} className="min-w-0">
          <MatchRow match={match} action={renderAction?.(match)} {...rowOptions} />
        </li>
      ))}
    </ul>
  )
}
