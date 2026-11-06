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
  /** Who the entry is shown to; omitted means everyone, including demo visitors. The routes are guarded on the server. */
  audience?: "account" | "admin"
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
        audience: "account",
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
        audience: "admin",
      },
    ],
  },
]

export const navItems: NavItem[] = navSections.flatMap((section) => section.items)

export const mobileNavItems: NavItem[] = navItems.filter((item) => item.mobile)

type NavViewer = { role: string } | null

function isVisibleTo(item: NavItem, viewer: NavViewer): boolean {
  if (item.audience === "admin") return viewer?.role === "ADMIN"
  if (item.audience === "account") return viewer !== null
  return true
}

/** The sections this viewer sees. A convenience only: it hides links, and the server enforces access. */
export function navSectionsFor(viewer: NavViewer): NavSection[] {
  return navSections
    .map((section) => ({ ...section, items: section.items.filter((item) => isVisibleTo(item, viewer)) }))
    .filter((section) => section.items.length > 0)
}

export function mobileNavItemsFor(viewer: NavViewer): NavItem[] {
  return mobileNavItems.filter((item) => isVisibleTo(item, viewer))
}

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
