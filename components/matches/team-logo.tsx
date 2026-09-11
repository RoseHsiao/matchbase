import { cn } from "cn"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import type { Team } from "@/lib/data/types"

type TeamLogoProps = {
  team: Pick<Team, "name" | "code" | "color" | "logoUrl">
  size?: "xs" | "sm" | "default" | "lg" | "xl"
  className?: string
}

const sizeClassName: Record<NonNullable<TeamLogoProps["size"]>, string> = {
  xs: "size-5 text-[9px] tracking-normal",
  sm: "size-6 text-[9px]",
  default: "size-8 text-[10px]",
  lg: "size-10 text-xs",
  xl: "size-16 text-base",
}

/** Pick black or white text for a hex background. */
function readableTextColor(hex: string): string {
  const value = hex.replace("#", "")
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? "#111111" : "#ffffff"
}

/**
 * Team crest. Falls back to a coloured code badge until real logos exist;
 * the extra-small size shows only the first letter so it fits.
 * Always rendered next to the team name, so it is hidden from screen readers.
 */
export function TeamLogo({ team, size = "default", className }: TeamLogoProps) {
  return (
    <Avatar
      title={team.name}
      aria-hidden
      className={cn(
        "rounded-md after:rounded-md",
        sizeClassName[size],
        className
      )}
    >
      {team.logoUrl ? <AvatarImage src={team.logoUrl} alt="" /> : null}
      <AvatarFallback
        className="rounded-md font-semibold tracking-wide"
        style={{ backgroundColor: team.color, color: readableTextColor(team.color) }}
      >
        {size === "xs" ? team.code.slice(0, 1) : team.code.slice(0, 3)}
      </AvatarFallback>
    </Avatar>
  )
}
