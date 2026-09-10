import Link from "next/link"
import { cn } from "cn"

type ListRowLinkProps = React.ComponentProps<typeof Link>

/** Full-width clickable row used inside list panels. */
export function ListRowLink({ className, ...props }: ListRowLinkProps) {
  return (
    <Link
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2.5 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50",
        className
      )}
      {...props}
    />
  )
}
