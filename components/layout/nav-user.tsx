"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ChevronsUpDownIcon,
  LogInIcon,
  LogOutIcon,
  ShieldCheckIcon,
  UserPlusIcon,
  UserRoundIcon,
} from "lucide-react"

import { announceAuthChange } from "@/components/auth/session-sync"
import { useSignUpOpen, useViewer } from "@/components/auth/viewer-provider"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { authClient } from "@/lib/auth/client"

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

/**
 * Sidebar footer account control. Anonymous: a "Sign in" entry, plus
 * "Create account" when the deployment accepts public sign-up. Signed in:
 * the account menu with the role and a sign-out action. Who is signed in
 * comes from the server render (ViewerProvider); signing out calls the auth
 * endpoint, returns to the public landing page and re-renders the tree so
 * every store is reseeded as anonymous.
 */
export function NavUser() {
  const viewer = useViewer()
  const signUpOpen = useSignUpOpen()
  const { isMobile } = useSidebar()
  const router = useRouter()
  const [signingOut, setSigningOut] = React.useState(false)

  async function signOut() {
    setSigningOut(true)
    try {
      await authClient.signOut()
    } finally {
      setSigningOut(false)
      announceAuthChange()
      router.push("/")
      router.refresh()
    }
  }

  if (!viewer) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" tooltip="Sign in" render={<Link href="/sign-in" />}>
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <LogInIcon className="size-4" />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">Sign in</span>
              <span className="truncate text-xs text-muted-foreground">{signUpOpen ? "With an existing account" : "For authorized accounts"}</span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {signUpOpen ? (
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="Create account" render={<Link href="/sign-up" />}>
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <UserPlusIcon className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">Create account</span>
                <span className="truncate text-xs text-muted-foreground">Follow teams, save matches</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
      </SidebarMenu>
    )
  }

  const admin = viewer.role === "ADMIN"

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-[popup-open]:bg-sidebar-accent data-[popup-open]:text-sidebar-accent-foreground"
              />
            }
          >
            <Avatar className="size-8 rounded-lg after:rounded-lg">
              <AvatarFallback className="rounded-lg">{initials(viewer.name)}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{viewer.name}</span>
              <span className="truncate text-xs text-muted-foreground">{viewer.email}</span>
            </div>
            <ChevronsUpDownIcon className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            {/* Base UI requires a group around a menu label. */}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal">
                <div className="grid gap-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{viewer.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{viewer.email}</span>
                  <Badge variant={admin ? "default" : "secondary"} className="w-fit">
                    {admin ? <ShieldCheckIcon data-icon="inline-start" /> : <UserRoundIcon data-icon="inline-start" />}
                    {admin ? "Administrator" : "Member"}
                  </Badge>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void signOut()} disabled={signingOut}>
              <LogOutIcon />
              {signingOut ? "Signing out…" : "Sign out"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
