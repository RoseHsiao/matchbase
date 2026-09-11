import { cn } from "cn"

export type DetailItem = {
  label: string
  value: React.ReactNode
}

type DetailListProps = {
  items: DetailItem[]
  className?: string
}

/** Label/value grid for facts about an entity. */
export function DetailList({ items, className }: DetailListProps) {
  return (
    <dl
      className={cn(
        "grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3",
        className
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="grid min-w-0 gap-0.5">
          <dt className="text-xs font-medium text-muted-foreground">
            {item.label}
          </dt>
          <dd className="truncate text-sm">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
