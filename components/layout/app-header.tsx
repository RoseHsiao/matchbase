"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { useBreadcrumbData } from "@/components/layout/breadcrumb-data-provider"
import { ADMIN_ROOT, findAdminNavItem, isAdminPath } from "@/lib/admin/navigation"
import { findNavItem } from "@/lib/navigation"
import { categoryLabel, sportCategory, sportLabel } from "@/lib/sports"
import { ReminderIndicator } from "@/components/reminders/reminder-indicator"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname()
  const current = findNavItem(pathname)
  const adminItem = isAdminPath(pathname) ? findAdminNavItem(pathname) : undefined
  const adminSub = adminItem && adminItem.href !== ADMIN_ROOT ? adminItem : undefined
  // League pages show the domain hierarchy: Category › Sport/Game › League.
  const { leagues } = useBreadcrumbData()
  const leagueId = /^\/leagues\/([^/]+)/.exec(pathname)?.[1]
  const league = leagueId ? leagues.find((entry) => entry.id === leagueId) : undefined

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/80">
      <SidebarTrigger className="-ml-1" />
      <Separator
        orientation="vertical"
        className="mr-2 data-[orientation=vertical]:h-4"
      />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem className="hidden sm:block">
            <BreadcrumbLink render={<Link href="/dashboard" />}>
              MatchBase
            </BreadcrumbLink>
          </BreadcrumbItem>
          {current ? (
            <>
              <BreadcrumbSeparator className="hidden sm:block" />
              <BreadcrumbItem>
                {adminSub ? (
                  <BreadcrumbLink render={<Link href={ADMIN_ROOT} />}>
                    {current.title}
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>{current.title}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </>
          ) : null}
          {adminSub ? (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{adminSub.title}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          ) : null}
          {league ? (
            <>
              <BreadcrumbSeparator className="hidden sm:block" />
              <BreadcrumbItem className="hidden sm:block">
                {categoryLabel(sportCategory(league.sport))}
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden sm:block" />
              <BreadcrumbItem className="hidden sm:block">{sportLabel(league.sport)}</BreadcrumbItem>
              <BreadcrumbSeparator className="hidden sm:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>{league.name}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          ) : null}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex items-center gap-1">
        {children}
        <ReminderIndicator />
        <ThemeToggle />
      </div>
    </header>
  )
}
