import Link from "next/link"
import { cn } from "cn"

import type { Category, Sport } from "@/lib/data/types"
import { categoryVisuals, getSportDefinition } from "@/lib/sport-icons"
import { categoryLabel } from "@/lib/sports"

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

type SportLineProps = {
  sport: Sport
  /** League label shown after the sport name, e.g. "NBA". */
  league?: { id: string; label: string }
  /** Link the league label to its page. */
  linked?: boolean
  size?: IconSize
  className?: string
}

/**
 * "[icon] Basketball · NBA": the Category › Sport › League hierarchy in one
 * line, with the sport icon as the visual anchor.
 */
export function SportLine({ sport, league, linked = false, size = "sm", className }: SportLineProps) {
  const { name } = getSportDefinition(sport)
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <SportIcon sport={sport} size={size} label="" />
      <span className="truncate">
        {name}
        {league ? (
          <>
            {" · "}
            {linked ? (
              <Link
                href={`/leagues/${league.id}`}
                className="rounded-sm outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {league.label}
              </Link>
            ) : (
              league.label
            )}
          </>
        ) : null}
      </span>
    </span>
  )
}
