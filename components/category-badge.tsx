import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import type { Category } from "@/lib/data/types"
import { categoryLabel } from "@/lib/sports"

type CategoryBadgeProps = {
  category: Category
  /** Smaller variant for dense cards and rows. */
  size?: "default" | "sm"
  className?: string
}

/** Top-level domain marker: "Sports" or "Esports". */
export function CategoryBadge({ category, size = "default", className }: CategoryBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(size === "sm" && "h-4 px-1.5 text-[10px]", className)}
    >
      {categoryLabel(category)}
    </Badge>
  )
}
