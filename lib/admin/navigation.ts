import {
  ActivityIcon,
  AwardIcon,
  BarChart3Icon,
  BellIcon,
  CalendarRangeIcon,
  ChartLineIcon,
  DatabaseIcon,
  GaugeIcon,
  HeartPulseIcon,
  MapPinIcon,
  ScrollTextIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
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

/**
 * A navigation entry without a page yet. Shown inactive in the sidebar, has
 * no href, and is excluded from route lookups until the page exists.
 */
export type AdminNavPlaceholder = {
  title: string
  icon: LucideIcon
  description: string
  inactive: true
}

export type AdminNavEntry = AdminNavItem | AdminNavPlaceholder

export function isRoutable(entry: AdminNavEntry): entry is AdminNavItem {
  return "href" in entry
}

export type AdminNavSection = {
  /** Caption shown above the items. Optional so a section can hold ungrouped items. */
  label?: string
  items: AdminNavEntry[]
}

/** Root of the admin workspace. It is the single "Admin" entry in the main sidebar, not a Dashboard. */
export const ADMIN_ROOT = "/admin"

/**
 * "Manage" navigation: the core catalogue management, grouped for the sidebar.
 * Group labels are visual only; they never navigate. Order here is the order
 * shown in the sidebar.
 */
export const adminManageSections: AdminNavSection[] = [
  {
    label: "Competition",
    items: [
      { title: "Sports & Games", href: "/admin/sports", icon: TrophyIcon, description: "Top-level sports and esports titles." },
      { title: "Leagues", href: "/admin/leagues", icon: AwardIcon, description: "Competitions within each sport or game." },
      { title: "Seasons", href: "/admin/seasons", icon: CalendarRangeIcon, description: "Season windows for every league." },
    ],
  },
  {
    label: "Entities",
    items: [
      { title: "Teams", href: "/admin/teams", icon: UsersIcon, description: "Teams across all leagues." },
      { title: "Players", href: "/admin/players", icon: UserRoundIcon, description: "Players and their current teams." },
      { title: "Venues", href: "/admin/venues", icon: MapPinIcon, description: "Physical venues for traditional sports." },
    ],
  },
  {
    // Reserved subsection: today it holds the single Matches page, later its sub-pages.
    label: "Matches",
    items: [
      { title: "Matches", href: "/admin/matches", icon: SwordsIcon, description: "Fixtures, live matches, and results." },
    ],
  },
  {
    label: "Data",
    items: [
      { title: "Data Sources", href: "/admin/data-sources", icon: DatabaseIcon, description: "External feeds and manual imports." },
      { title: "Sync Logs", href: "/admin/sync-logs", icon: RefreshCwIcon, description: "History of synchronisation runs." },
    ],
  },
]

/**
 * Landing routes of the three reserved workspaces. These are what the
 * breadcrumb and page metadata resolve to; the sidebar shows them as the
 * "Overview" child of each section.
 */
export const adminWorkspaceItems: AdminNavItem[] = [
  { title: "Analytics", href: "/admin/analytics", icon: BarChart3Icon, description: "Coverage, volume, and engagement reporting." },
  { title: "Monitoring", href: "/admin/monitoring", icon: ActivityIcon, description: "Feed health, sync status, and alerts." },
  { title: "Settings", href: "/admin/settings", icon: SettingsIcon, description: "Workspace configuration and access." },
]

/** A top-level admin section: a non-clickable label over one or more groups. */
export type AdminWorkspaceSection = {
  title: string
  groups: AdminNavSection[]
}

const [analytics, monitoring, settings] = adminWorkspaceItems

/**
 * The four parallel admin sections shown under Admin. Section titles and group
 * labels are visual only; they never navigate. Inactive entries reserve pages
 * that are not built yet.
 */
export const adminSections: AdminWorkspaceSection[] = [
  { title: "Manage", groups: adminManageSections },
  {
    title: "Analytics",
    groups: [
      {
        items: [
          { title: "Overview", href: analytics.href, icon: GaugeIcon, description: analytics.description },
          { title: "Match Analytics", icon: ChartLineIcon, description: "Match volume and coverage.", inactive: true },
          { title: "User Activity", icon: UsersIcon, description: "Follows, watchlists, and engagement.", inactive: true },
        ],
      },
    ],
  },
  {
    title: "Monitoring",
    groups: [
      {
        items: [
          { title: "Overview", href: monitoring.href, icon: GaugeIcon, description: monitoring.description },
          { title: "Sync Health", icon: HeartPulseIcon, description: "Feed and sync status over time.", inactive: true },
          { title: "System Logs", icon: ScrollTextIcon, description: "Application and job logs.", inactive: true },
        ],
      },
    ],
  },
  {
    title: "Settings",
    groups: [
      {
        items: [
          { title: "General", href: settings.href, icon: SlidersHorizontalIcon, description: settings.description },
          { title: "Data Sources", icon: DatabaseIcon, description: "Credentials and feed configuration.", inactive: true },
          { title: "Notifications", icon: BellIcon, description: "Alert channels and preferences.", inactive: true },
        ],
      },
    ],
  },
]

/** Every routable admin page, for lookups and breadcrumbs. Inactive entries are excluded. */
export const adminNavItems: AdminNavItem[] = [
  ...adminManageSections.flatMap((section) => section.items.filter(isRoutable)),
  ...adminWorkspaceItems,
]

export function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_ROOT || pathname.startsWith(`${ADMIN_ROOT}/`)
}

export function isAdminNavItemActive(pathname: string, item: AdminNavItem): boolean {
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
