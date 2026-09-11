import {
  CalendarDays,
  History,
  LayoutDashboard,
  ShieldCheck,
  Star,
  Swords,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react"

export type NavItem = {
  title: string
  href: string
  icon: LucideIcon
  description: string
  /** Show in the mobile bottom navigation bar. Keep to 4 items. */
  mobile?: boolean
}

export type NavSection = {
  label: string
  items: NavItem[]
}

export const navSections: NavSection[] = [
  {
    label: "Overview",
    items: [
      {
        title: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        description: "Your matches, watchlist, and what is happening today.",
        mobile: true,
      },
      {
        title: "Schedule",
        href: "/schedule",
        icon: CalendarDays,
        description: "Upcoming fixtures and start times.",
        mobile: true,
      },
    ],
  },
  {
    label: "Explore",
    items: [
      {
        title: "Matches",
        href: "/matches",
        icon: Swords,
        description: "Browse live, upcoming, and finished matches.",
        mobile: true,
      },
      {
        title: "Watchlist",
        href: "/watchlist",
        icon: Star,
        description: "Matches, teams, and players you are following.",
        mobile: true,
      },
      {
        title: "Teams",
        href: "/teams",
        icon: Users,
        description: "Team profiles, rosters, and form.",
      },
      {
        title: "Players",
        href: "/players",
        icon: UserRound,
        description: "Player profiles and statistics.",
      },
      {
        title: "History",
        href: "/history",
        icon: History,
        description: "Past results and head-to-head records.",
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        title: "Admin",
        href: "/admin",
        icon: ShieldCheck,
        description: "Manage data sources, users, and settings.",
      },
    ],
  },
]

export const navItems: NavItem[] = navSections.flatMap((section) => section.items)

export const mobileNavItems: NavItem[] = navItems.filter((item) => item.mobile)

export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** Best match for the current pathname, or undefined for unknown routes. */
export function findNavItem(pathname: string): NavItem | undefined {
  return navItems.find((item) => isNavItemActive(pathname, item.href))
}

/** Exact lookup by href. Throws so a typo in a page file fails at build time. */
export function getNavItem(href: string): NavItem {
  const item = navItems.find((entry) => entry.href === href)
  if (!item) {
    throw new Error(`No navigation item registered for "${href}".`)
  }
  return item
}
