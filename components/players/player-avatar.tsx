import { cn } from "cn"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import type { Player } from "@/lib/data/types"

type PlayerAvatarProps = {
  player: Pick<Player, "name" | "handle">
  size?: "sm" | "default" | "lg" | "xl"
  className?: string
}

const sizeClassName: Record<NonNullable<PlayerAvatarProps["size"]>, string> = {
  sm: "size-6 text-[9px]",
  default: "size-8 text-[10px]",
  lg: "size-10 text-xs",
  xl: "size-16 text-base",
}

function initials(player: Pick<Player, "name" | "handle">): string {
  if (player.handle) return player.handle.slice(0, 2).toUpperCase()
  return player.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

/**
 * Player portrait. Initials placeholder until real photos exist.
 * Always rendered next to the player's name, so it is hidden from screen readers.
 */
export function PlayerAvatar({ player, size = "default", className }: PlayerAvatarProps) {
  return (
    <Avatar aria-hidden className={cn(sizeClassName[size], className)}>
      <AvatarFallback className="bg-muted font-semibold text-muted-foreground">
        {initials(player)}
      </AvatarFallback>
    </Avatar>
  )
}
