import { Crosshair, Gamepad2, Swords, Target, Trophy, Volleyball, type LucideIcon } from "lucide-react"
import type { ComponentType, SVGProps } from "react"

import type { Category, Sport } from "@/lib/data/types"
import { sportMeta } from "@/lib/sports"

/**
 * Visual identity for every sport, game, and category. This is the only place
 * that maps an id to a glyph; components render through `SportIcon` and
 * `CategoryIcon` (components/sport-icon.tsx) and never choose icons themselves.
 *
 * - Team and individual sports use custom stroke glyphs drawn in the Lucide
 *   grid (24x24, 2px stroke), because Lucide ships no ball icons.
 * - Esports titles use a Lucide fallback glyph until an official logo asset is
 *   added: put the file in `public/sports/` and set `asset` on the entry; the
 *   component prefers the asset when present. No official brand artwork is
 *   bundled here.
 * - Category icons are deliberately generic and secondary to the sport icon.
 */

export type IconComponent = LucideIcon | ComponentType<SVGProps<SVGSVGElement>>

export type SportVisual = {
  /** Vector glyph, always available. */
  icon: IconComponent
  /** Optional logo asset served from `public/`, used instead of the glyph when set. */
  asset?: string
}

function glyph(paths: React.ReactNode, displayName: string): ComponentType<SVGProps<SVGSVGElement>> {
  const Glyph = (props: SVGProps<SVGSVGElement>) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {paths}
    </svg>
  )
  Glyph.displayName = displayName
  return Glyph
}

const BasketballGlyph = glyph(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3v18" />
    <path d="M3 12h18" />
    <path d="M5.6 5.6c3.5 3.5 3.5 9.3 0 12.8" />
    <path d="M18.4 5.6c-3.5 3.5-3.5 9.3 0 12.8" />
  </>,
  "BasketballGlyph"
)

const FootballGlyph = glyph(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m12 7 3.8 2.8-1.4 4.5H9.6L8.2 9.8Z" />
    <path d="M12 3v4" />
    <path d="m15.8 9.8 3.9-1.3" />
    <path d="m14.4 14.3 2.4 3.4" />
    <path d="m9.6 14.3-2.4 3.4" />
    <path d="M8.2 9.8 4.3 8.5" />
  </>,
  "FootballGlyph"
)

const TennisGlyph = glyph(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M4.5 6.5c3.5 1 5.5 3 5.5 5.5s-2 4.5-5.5 5.5" />
    <path d="M19.5 6.5c-3.5 1-5.5 3-5.5 5.5s2 4.5 5.5 5.5" />
  </>,
  "TennisGlyph"
)

const TableTennisGlyph = glyph(
  <>
    <circle cx="16.5" cy="7.5" r="1.5" />
    <path d="M13.2 13.2a6 6 0 1 0-8.5-8.5 6 6 0 0 0 8.5 8.5Z" />
    <path d="m11 11 8 8" />
  </>,
  "TableTennisGlyph"
)

const BadmintonGlyph = glyph(
  <>
    <circle cx="18" cy="18" r="2.5" />
    <path d="M16 16 8 8" />
    <path d="m8 8-4 1 3-5 1 4Z" />
    <path d="m8 8 5-3-1 5" />
  </>,
  "BadmintonGlyph"
)

/** Every sport in the registry must have a visual; TypeScript enforces the coverage. */
export const sportVisuals: Record<Sport, SportVisual> = {
  football: { icon: FootballGlyph },
  basketball: { icon: BasketballGlyph },
  tennis: { icon: TennisGlyph },
  lol: { icon: Swords },
  valorant: { icon: Crosshair },
  cs2: { icon: Target },
}

const BaseballGlyph = glyph(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M6.2 5.5c1.6 1.4 2.6 3.9 2.6 6.5s-1 5.1-2.6 6.5" />
    <path d="M17.8 5.5c-1.6 1.4-2.6 3.9-2.6 6.5s1 5.1 2.6 6.5" />
    <path d="M7.4 8.4 8.8 9" />
    <path d="M7.4 15.6 8.8 15" />
    <path d="m16.6 8.4-1.4.6" />
    <path d="m16.6 15.6-1.4-.6" />
  </>,
  "BaseballGlyph"
)

/** Glyphs ready for sports not yet in the registry, so adding one is a one-line change. */
export const reservedSportVisuals = {
  tabletennis: { icon: TableTennisGlyph },
  badminton: { icon: BadmintonGlyph },
  volleyball: { icon: Volleyball },
  baseball: { icon: BaseballGlyph },
} satisfies Record<string, SportVisual>

export const categoryVisuals: Record<Category, SportVisual> = {
  sports: { icon: Trophy },
  esports: { icon: Gamepad2 },
}

export type SportDefinition = {
  id: Sport
  category: Category
  name: string
  homeAway: boolean
  visual: SportVisual
}

/** Registry metadata and visual identity for one sport, as a single object. */
export function getSportDefinition(sport: Sport): SportDefinition {
  const meta = sportMeta[sport]
  return { id: sport, category: meta.category, name: meta.label, homeAway: meta.homeAway, visual: sportVisuals[sport] }
}
