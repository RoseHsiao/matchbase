import { cn } from "cn"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import type { Team } from "@/lib/data/types"
import { sanitizeImageUrl } from "@/lib/safe-url"

type TeamLogoProps = {
  team: Pick<Team, "name" | "code" | "color" | "logoUrl">
  size?: "xs" | "sm" | "default" | "lg" | "xl"
  className?: string
}

type Size = NonNullable<TeamLogoProps["size"]>

/** Box per size, and the text scale for short (1-2 character) and long (3 character) codes. */
const sizeClassName: Record<Size, { box: string; short: string; long: string }> = {
  xs: { box: "size-5", short: "text-[9px] tracking-normal", long: "text-[9px] tracking-normal" },
  sm: { box: "size-6", short: "text-[9px] tracking-wide", long: "text-[7.5px] tracking-normal" },
  default: { box: "size-8", short: "text-[10px] tracking-wide", long: "text-[9px] tracking-normal" },
  lg: { box: "size-10", short: "text-xs tracking-wide", long: "text-[10px] tracking-normal" },
  xl: { box: "size-16", short: "text-base tracking-wide", long: "text-sm tracking-normal" },
}

/** Codes are two to four letters; the badge shows at most three so nothing can overflow the box. */
const MAX_CODE_CHARS = 3

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
 * the extra-small size shows only the first letter so it fits, and three
 * letter codes use a slightly smaller scale than one or two letter codes.
 * Always rendered next to the team name, so it is hidden from screen readers.
 */
export function TeamLogo({ team, size = "default", className }: TeamLogoProps) {
  const code = size === "xs" ? team.code.slice(0, 1) : team.code.slice(0, MAX_CODE_CHARS)
  const scale = sizeClassName[size]
  // Defence in depth: the write boundaries already reject non-https addresses.
  const logoSrc = sanitizeImageUrl(team.logoUrl, { allowHttp: process.env.NODE_ENV !== "production" })
  return (
    <Avatar
      title={team.name}
      aria-hidden
      className={cn("rounded-md after:rounded-md", scale.box, className)}
    >
      {logoSrc ? <AvatarImage src={logoSrc} alt="" /> : null}
      <AvatarFallback
        className={cn("overflow-hidden rounded-md px-0.5 font-semibold leading-none", code.length >= 3 ? scale.long : scale.short)}
        style={{ backgroundColor: team.color, color: readableTextColor(team.color) }}
      >
        {code}
      </AvatarFallback>
    </Avatar>
  )
}
