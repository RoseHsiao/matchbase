import {
  AwardIcon,
  CalendarRangeIcon,
  DatabaseIcon,
  LayoutDashboardIcon,
  MapPinIcon,
  RefreshCwIcon,
  SwordsIcon,
  TrophyIcon,
  UserRoundIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react"

export type AdminNavItem = {
  title: string
  href: string
  icon: LucideIcon
  description: string
}

export const ADMIN_ROOT = "/admin"

export const adminNavItems: AdminNavItem[] = [
  { title: "Dashboard", href: "/admin", icon: LayoutDashboardIcon, description: "Overview of the catalogue, activity, and data health." },
  { title: "Sports & Games", href: "/admin/sports", icon: TrophyIcon, description: "Top-level sports and esports titles." },
  { title: "Leagues", href: "/admin/leagues", icon: AwardIcon, description: "Competitions within each sport or game." },
  { title: "Seasons", href: "/admin/seasons", icon: CalendarRangeIcon, description: "Season windows for every league." },
  { title: "Teams", href: "/admin/teams", icon: UsersIcon, description: "Teams across all leagues." },
  { title: "Players", href: "/admin/players", icon: UserRoundIcon, description: "Players and their current teams." },
  { title: "Matches", href: "/admin/matches", icon: SwordsIcon, description: "Fixtures, live matches, and results." },
  { title: "Venues", href: "/admin/venues", icon: MapPinIcon, description: "Physical venues for traditional sports." },
  { title: "Data Sources", href: "/admin/data-sources", icon: DatabaseIcon, description: "External feeds and manual imports." },
  { title: "Sync Logs", href: "/admin/sync-logs", icon: RefreshCwIcon, description: "History of synchronisation runs." },
]

export function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_ROOT || pathname.startsWith(`${ADMIN_ROOT}/`)
}

export function isAdminNavItemActive(pathname: string, item: AdminNavItem): boolean {
  if (item.href === ADMIN_ROOT) return pathname === ADMIN_ROOT
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}

export function findAdminNavItem(pathname: string): AdminNavItem | undefined {
  return adminNavItems.find((item) => isAdminNavItemActive(pathname, item))
}

/** Exact lookup by href. Throws so a typo in a page file fails at build time. */
export function getAdminNavItem(href: string): AdminNavItem {
  const item = adminNavItems.find((entry) => entry.href === href)
  if (!item) throw new Error(`No admin navigation item registered for "${href}".`)
  return item
}
