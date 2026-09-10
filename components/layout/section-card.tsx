import Link from "next/link"
import { ArrowRightIcon } from "lucide-react"
import { cn } from "cn"

import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type SectionCardProps = {
  title: string
  description?: string
  /** Where the header action goes. Omit to hide the action. */
  href?: string
  actionLabel?: string
  children: React.ReactNode
  className?: string
  contentClassName?: string
}

/** Titled card panel with an optional "View all" action. */
export function SectionCard({
  title,
  description,
  href,
  actionLabel = "View all",
  children,
  className,
  contentClassName,
}: SectionCardProps) {
  return (
    <Card className={cn("min-w-0 gap-3", className)}>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {href ? (
          <CardAction>
            <Link
              href={href}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              {actionLabel}
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className={cn("px-1", contentClassName)}>
        {children}
      </CardContent>
    </Card>
  )
}
