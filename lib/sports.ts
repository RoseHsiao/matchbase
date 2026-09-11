import type { Sport } from "@/lib/data/types"

const sportLabels: Record<Sport, string> = {
  football: "Football",
  basketball: "Basketball",
  lol: "League of Legends",
  valorant: "Valorant",
  cs2: "Counter-Strike 2",
}

/** Every sport in display order. */
export const sports: Sport[] = ["football", "basketball", "lol", "valorant", "cs2"]

export function sportLabel(sport: Sport): string {
  return sportLabels[sport]
}
