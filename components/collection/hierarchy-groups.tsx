import { cn } from "cn"

import { CategoryLine, SportHierarchy, SportLine } from "@/components/sport-icon"
import type { GroupedCollection, HierarchySection } from "@/lib/hierarchy"

type Noun = { one: string; other: string }

function countLabel(count: number, noun: Noun): string {
  return `${count} ${count === 1 ? noun.one : noun.other}`
}

type HierarchyGroupsProps<T> = {
  grouped: GroupedCollection<T>
  itemKey: (item: T) => string
  renderItem: (item: T) => React.ReactNode
  /** "team" / "teams", for the counts beside each heading. */
  noun: Noun
  className?: string
}

const GRID = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"

/**
 * A collection laid out along Category → Sport/Game → League, using the shared
 * hierarchy vocabulary: category as a muted line with its generic icon, the
 * sport as its registry glyph plus name, the league as trailing text metadata.
 *
 * Which headings appear is decided by `grouped.layout` and `grouped.established`
 * (lib/hierarchy.ts), never here: a level the filters already fix is not
 * repeated as a heading.
 */
export function HierarchyGroups<T>({ grouped, itemKey, renderItem, noun, className }: HierarchyGroupsProps<T>) {
  const grid = (items: T[]) => (
    <ul className={GRID}>
      {items.map((item) => (
        <li key={itemKey(item)} className="min-w-0">
          {renderItem(item)}
        </li>
      ))}
    </ul>
  )

  if (grouped.layout === "flat") {
    return grid([...grouped.tiers.flatMap((tier) => tier.sections.flatMap((s) => s.items)), ...grouped.unassigned])
  }

  const unassigned =
    grouped.unassigned.length > 0 ? (
      <section aria-labelledby="hierarchy-unassigned" className="grid gap-2">
        <h2 id="hierarchy-unassigned" className="flex flex-wrap items-center gap-x-2 px-1 text-sm font-semibold">
          Not in a competition yet
          <span className="text-xs font-normal text-muted-foreground">{countLabel(grouped.unassigned.length, noun)}</span>
        </h2>
        {grid(grouped.unassigned)}
      </section>
    ) : null

  if (grouped.layout === "tiers") {
    return (
      <div className={cn("grid gap-8", className)}>
        {grouped.tiers.map((tier) => {
          const headingId = `hierarchy-${tier.category}`
          return (
            <section key={tier.category} aria-labelledby={headingId} className="grid gap-4">
              <h2 id={headingId} className="flex flex-wrap items-center gap-x-2 px-1">
                <CategoryLine category={tier.category} size="sm" className="text-sm font-semibold text-foreground" />
                <span className="text-xs text-muted-foreground">{countLabel(tier.count, noun)}</span>
              </h2>
              <div className="grid gap-5">
                {tier.sections.map((section) => (
                  <SectionBlock key={section.key} section={section} grouped={grouped} noun={noun} grid={grid} headingTag="h3" />
                ))}
              </div>
            </section>
          )
        })}
        {unassigned}
      </div>
    )
  }

  return (
    <div className={cn("grid gap-6", className)}>
      {grouped.tiers.flatMap((tier) =>
        tier.sections.map((section) => (
          <SectionBlock key={section.key} section={section} grouped={grouped} noun={noun} grid={grid} headingTag="h2" />
        ))
      )}
      {unassigned}
    </div>
  )
}

type SectionBlockProps<T> = {
  section: HierarchySection<T>
  grouped: GroupedCollection<T>
  noun: Noun
  grid: (items: T[]) => React.ReactNode
  headingTag: "h2" | "h3"
}

/** One "Sport · League" block. The heading shows only the levels the filters leave open. */
function SectionBlock<T>({ section, grouped, noun, grid, headingTag: Heading }: SectionBlockProps<T>) {
  const { established } = grouped
  const headingId = `hierarchy-${section.key.replace(/[^a-z0-9]+/gi, "-")}`
  const league = section.league ? { id: section.league.id, label: section.league.name } : undefined
  const leagueClassName = "font-normal text-muted-foreground"
  const showCategory = !established.category && grouped.layout !== "tiers"

  return (
    <section aria-labelledby={headingId} className="grid gap-2">
      <Heading id={headingId} className="flex min-w-0 flex-wrap items-center gap-x-2 px-1 text-sm font-semibold">
        {showCategory ? (
          <SportHierarchy
            sport={section.sport}
            league={league}
            linked
            size="sm"
            className="min-w-0 [&>span:first-child]:font-normal"
            leagueClassName={leagueClassName}
          />
        ) : (
          <SportLine
            sport={section.sport}
            league={league}
            linked
            showSport={!established.sport}
            size="sm"
            className="min-w-0"
            leagueClassName={leagueClassName}
          />
        )}
        <span className="text-xs font-normal text-muted-foreground">{countLabel(section.items.length, noun)}</span>
      </Heading>
      {grid(section.items)}
    </section>
  )
}
