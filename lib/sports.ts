import type { Category, Sport } from "@/lib/data/types"

/**
 * Data-driven metadata for every sport and game. Anything that differs
 * between disciplines should be a property here, not a conditional in UI.
 */
export type SportMeta = {
  label: string
  category: Category
  /** Whether one side has a home venue; drives "Home/Away" and "at" wording. */
  homeAway: boolean
}

export const sportMeta: Record<Sport, SportMeta> = {
  football: { label: "Football", category: "sports", homeAway: true },
  basketball: { label: "Basketball", category: "sports", homeAway: true },
  lol: { label: "League of Legends", category: "esports", homeAway: false },
  valorant: { label: "Valorant", category: "esports", homeAway: false },
  cs2: { label: "Counter-Strike 2", category: "esports", homeAway: false },
}

const categoryLabels: Record<Category, string> = {
  sports: "Sports",
  esports: "Esports",
}

/** Top-level categories in display order. */
export const categories: Category[] = ["sports", "esports"]

/** Every sport and game in display order. */
export const sports: Sport[] = ["football", "basketball", "lol", "valorant", "cs2"]

export function categoryLabel(category: Category): string {
  return categoryLabels[category]
}

export function sportLabel(sport: Sport): string {
  return sportMeta[sport].label
}

export function sportCategory(sport: Sport): Category {
  return sportMeta[sport].category
}

export function hasHomeAdvantage(sport: Sport): boolean {
  return sportMeta[sport].homeAway
}

/** "Sports · Basketball · NBA" */
export function hierarchyLabel(sport: Sport, leagueName: string): string {
  return `${categoryLabel(sportCategory(sport))} · ${sportLabel(sport)} · ${leagueName}`
}
