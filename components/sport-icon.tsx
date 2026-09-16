import Link from "next/link"
import { cn } from "cn"

import type { Category, Sport } from "@/lib/data/types"
import { categoryVisuals, getSportDefinition } from "@/lib/sport-icons"
import { categoryLabel } from "@/lib/sports"

/**
 * The visual vocabulary for the Category → Sport/Game → League hierarchy.
 * Three levels, three treatments, used on every surface:
 *
 * - Category ("Sports" / "Esports") is subtle context: a small generic icon
 *   with a muted label (`CategoryLine`), or the icon alone with an accessible
 *   name where space is tight (`CategoryIcon`). Never a badge.
 * - Sport/Game carries the identity: its registry glyph beside its name
 *   (`SportIcon`, `SportLine`).
 * - League is readable metadata after the sport: "Basketball · NBA".
 *
 * `SportHierarchy` composes all three for headers and cards. Nothing here
 * decides icons; that is the registry in lib/sport-icons.tsx.
 */

const sizeClassName = {
  xs: "size-3.5",
  sm: "size-4",
  default: "size-5",
  lg: "size-6",
} as const

type IconSize = keyof typeof sizeClassName

type SportIconProps = {
  sport: Sport
  size?: IconSize
  /**
   * Accessible name. Defaults to the sport's name; pass an empty string only
   * when a text label for the sport sits right next to the icon.
   */
  label?: string
  className?: string
}

/** The sport or game glyph from the registry. Never picks an icon itself. */
export function SportIcon({ sport, size = "default", label, className }: SportIconProps) {
  const { name, visual } = getSportDefinition(sport)
  const accessibleName = label ?? name
  const common = {
    className: cn("shrink-0", sizeClassName[size], className),
    role: accessibleName ? "img" : undefined,
    "aria-label": accessibleName || undefined,
    "aria-hidden": accessibleName ? undefined : true,
  }
  if (visual.asset) {
    // eslint-disable-next-line @next/next/no-img-element -- static registry asset, no optimisation needed
    return <img src={visual.asset} alt={accessibleName} {...common} />
  }
  const Icon = visual.icon
  return <Icon {...common} />
}

type CategoryIconProps = {
  category: Category
  size?: IconSize
  /** Accessible name; defaults to the category label. Pass "" when the label is visible beside it. */
  label?: string
  className?: string
}

/** Generic category marker (sports vs esports), visually secondary to the sport icon. */
export function CategoryIcon({ category, size = "sm", label, className }: CategoryIconProps) {
  const Icon = categoryVisuals[category].icon
  const accessibleName = label ?? categoryLabel(category)
  return (
    <Icon
      className={cn("shrink-0 text-muted-foreground", sizeClassName[size], className)}
      role={accessibleName ? "img" : undefined}
      aria-label={accessibleName || undefined}
      aria-hidden={accessibleName ? undefined : true}
    />
  )
}

type CategoryLineProps = {
  category: Category
  size?: IconSize
  className?: string
}

/** "[icon] Sports" / "[icon] Esports": category as muted inline context, never a badge. */
export function CategoryLine({ category, size = "xs", className }: CategoryLineProps) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 text-muted-foreground", className)}>
      <CategoryIcon category={category} size={size} label="" />
      {categoryLabel(category)}
    </span>
  )
}

type SportLineProps = {
  sport: Sport
  /** League label shown after the sport name, e.g. "NBA". */
  league?: { id: string; label: string }
  /** Link the league label to its page. */
  linked?: boolean
  /** Hide the sport's name; the icon then carries it as its accessible name ("[icon] NBA"). */
  showSport?: boolean
  size?: IconSize
  className?: string
}

/**
 * "[icon] Basketball · NBA": the sport identity with the league as trailing
 * metadata. With `showSport={false}` it collapses to "[icon] NBA" for narrow
 * rows, keeping the sport's name on the icon for assistive technology.
 */
export function SportLine({ sport, league, linked = false, showSport = true, size = "sm", className }: SportLineProps) {
  const { name } = getSportDefinition(sport)
  const leagueLabel = league ? (
    linked ? (
      <Link
        href={`/leagues/${league.id}`}
        className="rounded-sm outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {league.label}
      </Link>
    ) : (
      league.label
    )
  ) : null
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <SportIcon sport={sport} size={size} label={showSport ? "" : name} />
      <span className="truncate">
        {showSport ? name : null}
        {showSport && league ? " · " : null}
        {leagueLabel}
      </span>
    </span>
  )
}

type SportHierarchyProps = {
  sport: Sport
  league?: { id: string; label: string }
  linked?: boolean
  /** "inline": one line "[cat] Sports · [sport] Basketball · NBA". "stacked": category above the sport line. */
  layout?: "inline" | "stacked"
  size?: IconSize
  className?: string
}

/** Category, sport, and league together, for headers and cards. */
export function SportHierarchy({ sport, league, linked = false, layout = "inline", size = "sm", className }: SportHierarchyProps) {
  const { category } = getSportDefinition(sport)
  if (layout === "stacked") {
    return (
      <span className={cn("grid min-w-0 gap-0.5", className)}>
        <CategoryLine category={category} size="xs" className="text-xs" />
        <SportLine sport={sport} league={league} linked={linked} size={size} />
      </span>
    )
  }
  return (
    <span className={cn("inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5", className)}>
      <CategoryLine category={category} size={size === "lg" ? "sm" : "xs"} />
      <span aria-hidden className="text-muted-foreground">·</span>
      <SportLine sport={sport} league={league} linked={linked} size={size} />
    </span>
  )
}
