import { MatchList } from "@/components/matches/match-list"
import { Card, CardContent } from "@/components/ui/card"
import { dayDifference, formatDayLabel, formatLongDate } from "@/lib/format"
import type { MatchDayGroup } from "@/lib/schedule"

type MatchDayListProps = {
  groups: MatchDayGroup[]
  /** Reference time for "Today" / "Tomorrow" headings. */
  now: Date
  showLeague?: boolean
}

/** Matches grouped under one heading per calendar day. */
export function MatchDayList({ groups, now, showLeague = true }: MatchDayListProps) {
  return (
    <div className="grid gap-6">
      {groups.map((group) => {
        const headingId = `match-day-${group.key}`
        const relative = Math.abs(dayDifference(now, group.date)) <= 1
        const count = group.matches.length
        return (
          <section key={group.key} aria-labelledby={headingId} className="grid gap-2">
            <h2
              id={headingId}
              className="flex flex-wrap items-baseline gap-x-2 px-1 text-sm font-semibold"
            >
              {formatDayLabel(group.date, now)}
              <span className="text-xs font-normal text-muted-foreground">
                {relative ? `${formatLongDate(group.date)} · ` : ""}
                {count} {count === 1 ? "match" : "matches"}
              </span>
            </h2>
            <Card className="py-1">
              <CardContent className="px-1">
                <MatchList
                  matches={group.matches}
                  now={now}
                  showDay={false}
                  showLeague={showLeague}
                />
              </CardContent>
            </Card>
          </section>
        )
      })}
    </div>
  )
}
