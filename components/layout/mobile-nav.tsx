"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { MenuIcon } from "lucide-react"
import { cn } from "cn"

import { isNavItemActive, mobileNavItems } from "@/lib/navigation"
import { useSidebar } from "@/components/ui/sidebar"

const itemClassName =
  "flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-5"

/** Bottom tab bar for small screens. "More" opens the full sidebar sheet. */
export function MobileNav() {
  const pathname = usePathname()
  const { toggleSidebar } = useSidebar()
  const columns = mobileNavItems.length + 1

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-backdrop-filter:bg-background/80 md:hidden"
    >
      <ul
        className="grid h-16"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {mobileNavItems.map((item) => {
          const active = isNavItemActive(pathname, item.href)
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(itemClassName, active && "text-primary")}
              >
                <item.icon />
                <span>{item.title}</span>
              </Link>
            </li>
          )
        })}
        <li>
          <button
            type="button"
            onClick={toggleSidebar}
            className={cn(itemClassName, "w-full")}
          >
            <MenuIcon />
            <span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  )
}
