import { getNavItem } from "@/lib/navigation"
import { PageHeader } from "@/components/layout/page-header"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

type PlaceholderPageProps = {
  /** Route href registered in lib/navigation.ts. Supplies title and description. */
  href: string
  /** Number of stat tiles to sketch above the main panel. */
  stats?: number
  children?: React.ReactNode
}

/**
 * Temporary page body used while a route has no real data.
 * Replace per route once the data layer exists.
 */
export function PlaceholderPage({
  href,
  stats = 4,
  children,
}: PlaceholderPageProps) {
  const item = getNavItem(href)

  return (
    <>
      <PageHeader
        title={item.title}
        description={item.description}
        actions={<Badge variant="secondary">Coming soon</Badge>}
      />

      {stats > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: stats }, (_, index) => (
            <Card key={index}>
              <CardHeader>
                <CardDescription>
                  <Skeleton className="h-4 w-24" />
                </CardDescription>
                <CardTitle>
                  <Skeleton className="h-7 w-16" />
                </CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : null}

      <Card className="flex-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <item.icon className="size-4 text-muted-foreground" />
            {item.title}
          </CardTitle>
          <CardDescription>
            This area will show {item.title.toLowerCase()} data once the
            data layer is connected.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {children ?? (
            <>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </>
          )}
        </CardContent>
      </Card>
    </>
  )
}
