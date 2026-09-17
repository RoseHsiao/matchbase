import type { Category, Sport } from "@/lib/data/types"
import { ALL, type HierarchyFilters } from "@/lib/schedule"
import { categories, sportCategory, sports } from "@/lib/sports"

/**
 * Pure grouping of a filtered collection along Category → Sport/Game → League.
 *
 * Used by the Teams and Players pages so both scan the same way. The rules
 * are data-driven: order comes from the sport registry, context comes from
 * the active filters, and nothing here knows a particular sport or league.
 *
 * Progressive simplification: a hierarchy level that the filters already
 * establish is never repeated as a heading. Selecting a league fixes the
 * sport and the category too, so the result is flat; selecting a sport
 * leaves only league headings; with nothing selected the collection is
 * tiered by category and sectioned by "Sport · League". Search collapses the
 * category tier into each section heading so results read as a short list
 * of leagues, each with its full context.
 */

/** The hierarchy position of one item: its sport and, when known, its league. */
export type HierarchyRef = { sport: Sport; league?: { id: string; name: string } }

export type HierarchyFilterInput = HierarchyFilters & {
  leagueId: string
  teamId?: string
  query?: string
}

/** Which hierarchy levels the active filters already establish. */
export type EstablishedLevels = { category: boolean; sport: boolean; league: boolean }

export type HierarchySection<T> = {
  key: string
  category: Category
  sport: Sport
  league?: { id: string; name: string }
  items: T[]
}

export type HierarchyTier<T> = {
  category: Category
  count: number
  sections: HierarchySection<T>[]
}

/**
 * - "tiers": category headings, each with "Sport · League" sections.
 * - "sections": no category tier; each section heading carries whatever
 *   context the filters do not already establish.
 * - "flat": one list; the filters name the whole context.
 */
export type GroupingLayout = "tiers" | "sections" | "flat"

export type GroupedCollection<T> = {
  layout: GroupingLayout
  established: EstablishedLevels
  /** In registry order: categories, then sports, then leagues by name. */
  tiers: HierarchyTier<T>[]
  /** Items with no hierarchy position (for example a player with no team and no matches yet). Rendered last. */
  unassigned: T[]
  total: number
}

/**
 * A narrower selection implies the broader ones: a league is in exactly one
 * sport, a sport in exactly one category, and a team in exactly one league.
 */
export function establishedLevels(filters: HierarchyFilterInput): EstablishedLevels {
  const league =
    filters.leagueId !== ALL || (filters.teamId !== undefined && filters.teamId !== ALL)
  const sport = league || filters.sport !== ALL
  const category = sport || filters.category !== ALL
  return { category, sport, league }
}

export function isSearching(filters: Pick<HierarchyFilterInput, "query">): boolean {
  return (filters.query ?? "").trim() !== ""
}

const categoryOrder = new Map(categories.map((category, index) => [category, index]))
const sportOrder = new Map(sports.map((sport, index) => [sport, index]))

function sectionKey(ref: HierarchyRef): string {
  return `${ref.sport}:${ref.league?.id ?? ""}`
}

/**
 * Group `items` (already filtered, in display order) by the hierarchy
 * position `refOf` reports for each. Items keep their relative order inside a
 * section.
 */
export function groupByHierarchy<T>(
  items: readonly T[],
  refOf: (item: T) => HierarchyRef | undefined,
  filters: HierarchyFilterInput
): GroupedCollection<T> {
  const established = establishedLevels(filters)
  const sections = new Map<string, HierarchySection<T>>()
  const unassigned: T[] = []

  for (const item of items) {
    const ref = refOf(item)
    if (!ref) {
      unassigned.push(item)
      continue
    }
    const key = sectionKey(ref)
    const section = sections.get(key)
    if (section) {
      section.items.push(item)
    } else {
      sections.set(key, {
        key,
        category: sportCategory(ref.sport),
        sport: ref.sport,
        league: ref.league,
        items: [item],
      })
    }
  }

  const ordered = [...sections.values()].sort(
    (a, b) =>
      (categoryOrder.get(a.category) ?? 0) - (categoryOrder.get(b.category) ?? 0) ||
      (sportOrder.get(a.sport) ?? 0) - (sportOrder.get(b.sport) ?? 0) ||
      (a.league?.name ?? "").localeCompare(b.league?.name ?? "")
  )

  const tiers: HierarchyTier<T>[] = []
  for (const section of ordered) {
    const tier = tiers.find((t) => t.category === section.category)
    if (tier) {
      tier.sections.push(section)
      tier.count += section.items.length
    } else {
      tiers.push({ category: section.category, count: section.items.length, sections: [section] })
    }
  }

  return {
    layout: chooseLayout(established, tiers.length, isSearching(filters)),
    established,
    tiers,
    unassigned,
    total: items.length,
  }
}

function chooseLayout(
  established: EstablishedLevels,
  tierCount: number,
  searching: boolean
): GroupingLayout {
  if (established.league) return "flat"
  // A category tier only earns its heading when there are two categories to tell apart
  // and the user is browsing rather than searching.
  if (established.category || searching || tierCount < 2) return "sections"
  return "tiers"
}
