import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { cn } from "cn"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type StatCardProps = {
  label: string
  value: number | string
  hint?: string
  icon: LucideIcon
  /** Makes the whole card a link. */
  href?: string
  className?: string
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
  className,
}: StatCardProps) {
  const card = (
    <Card
      size="sm"
      className={cn(
        "h-full gap-2",
        href && "transition-shadow hover:ring-foreground/20",
        className
      )}
    >
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">
          {value}
        </CardTitle>
        <CardAction>
          <div className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      {hint ? (
        <CardContent className="text-xs text-muted-foreground">
          {hint}
        </CardContent>
      ) : null}
    </Card>
  )

  if (!href) return card

  return (
    <Link
      href={href}
      className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {card}
    </Link>
  )
}
