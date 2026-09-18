"use client"

import * as React from "react"
import Link from "next/link"
import { cn } from "cn"
import { usePathname } from "next/navigation"
import { TrophyIcon } from "lucide-react"

import {
  ADMIN_ROOT,
  adminSections,
  isAdminNavItemActive,
  isAdminPath,
  isRoutable,
} from "@/lib/admin/navigation"
import { isNavItemActive, navSections } from "@/lib/navigation"
import { useViewer } from "@/components/auth/viewer-provider"
import { NavUser } from "@/components/layout/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()
  const viewer = useViewer()
  const inAdmin = isAdminPath(pathname)
  // The Admin entry is a convenience for administrators; the route itself is guarded on the server.
  const sections = navSections
    .map((section) => ({ ...section, items: section.items.filter((item) => item.href !== ADMIN_ROOT || viewer?.role === "ADMIN") }))
    .filter((section) => section.items.length > 0)

  // Close the mobile sheet after navigating so the new page is visible.
  function handleNavigate() {
    if (isMobile) setOpenMobile(false)
  }

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<Link href="/dashboard" onClick={handleNavigate} />}
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <TrophyIcon className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">MatchBase</span>
                <span className="truncate text-xs text-muted-foreground">
                  Match tracker
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {sections.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => (
                  <React.Fragment key={item.href}>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        isActive={isNavItemActive(pathname, item.href)}
                        tooltip={item.title}
                        render={<Link href={item.href} onClick={handleNavigate} />}
                      >
                        <item.icon />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    {inAdmin && item.href === ADMIN_ROOT ? (
                      <SidebarMenuItem>
                        <AdminContextNav pathname={pathname} onNavigate={handleNavigate} />
                      </SidebarMenuItem>
                    ) : null}
                  </React.Fragment>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

/**
 * Contextual admin navigation nested under the Admin entry: four parallel,
 * non-clickable section labels (Manage, Analytics, Monitoring, Settings), each
 * over its groups of navigation items. Group labels are plain text too.
 * Inactive entries reserve pages that are not built yet: no href, and the
 * sidebar button's own disabled treatment (muted, no hover, no pointer).
 * Indents and labels hide in icon-collapsed mode so item icons and tooltips
 * still work there.
 */
function AdminContextNav({
  pathname,
  onNavigate,
}: {
  pathname: string
  onNavigate: () => void
}) {
  const indent =
    "ml-3.5 border-l border-sidebar-border pl-2 group-data-[collapsible=icon]:ml-0 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:pl-0"
  const hideCollapsed = "group-data-[collapsible=icon]:hidden"

  return (
    <div className={cn(indent, "grid gap-3 pt-1 group-data-[collapsible=icon]:gap-1 group-data-[collapsible=icon]:pt-0")}>
      {adminSections.map((section) => (
        <div key={section.title} className="grid gap-1">
          {/* Section label: same style for all four, never a link. */}
          <div
            aria-hidden
            className={cn("px-2 text-xs font-medium text-sidebar-foreground/80", hideCollapsed)}
          >
            {section.title}
          </div>
          <div className={cn(indent, "grid gap-2")}>
            {section.groups.map((group, index) => (
              <div key={group.label ?? index} className="grid gap-0.5">
                {group.label ? (
                  <div
                    aria-hidden
                    className={cn("px-2 text-xs text-muted-foreground", hideCollapsed)}
                  >
                    {group.label}
                  </div>
                ) : null}
                <SidebarMenu aria-label={group.label ? `${section.title} · ${group.label}` : section.title}>
                  {group.items.map((item) => (
                    <SidebarMenuItem
                      key={item.title}
                      className={cn(!isRoutable(item) && hideCollapsed)}
                    >
                      {!isRoutable(item) ? (
                        <SidebarMenuButton render={<span aria-disabled="true" />}>
                          <item.icon />
                          <span>{item.title}</span>
                        </SidebarMenuButton>
                      ) : (
                        <SidebarMenuButton
                          isActive={isAdminNavItemActive(pathname, item)}
                          tooltip={item.title}
                          render={<Link href={item.href} onClick={onNavigate} />}
                        >
                          <item.icon />
                          <span>{item.title}</span>
                        </SidebarMenuButton>
                      )}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
