import { AppHeader } from "@/components/layout/app-header"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { MobileNav } from "@/components/layout/mobile-nav"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"

type AppShellProps = {
  children: React.ReactNode
  /** Initial desktop sidebar state, usually read from the sidebar cookie. */
  defaultOpen?: boolean
}

export function AppShell({ children, defaultOpen = true }: AppShellProps) {
  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={defaultOpen}>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <AppHeader />
          <div className="flex flex-1 flex-col gap-6 p-4 pb-24 md:p-6">
            {children}
          </div>
          <MobileNav />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
