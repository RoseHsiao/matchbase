"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"

import type { Viewer } from "@/lib/auth/authorization"
import { signInHref } from "@/lib/auth/redirect"

/**
 * Who the server says is viewing the app, for client components that adapt
 * their wording or controls (the account menu, the personal empty states,
 * the follow and watchlist stores). This is display state only: every
 * authorization decision is made again on the server, and the value here
 * comes from the server render, never from a client-side session read.
 */

const ViewerContext = React.createContext<Viewer | null | undefined>(undefined)

export function ViewerProvider({ viewer, children }: { viewer: Viewer | null; children: React.ReactNode }) {
  return <ViewerContext.Provider value={viewer}>{children}</ViewerContext.Provider>
}

/** The viewer, or null for an anonymous visitor. */
export function useViewer(): Viewer | null {
  const viewer = React.useContext(ViewerContext)
  if (viewer === undefined) throw new Error("useViewer must be used within a ViewerProvider.")
  return viewer
}

/** Sends an anonymous visitor to sign in and back to the current page afterwards. */
export function useSignInPrompt(): () => void {
  const router = useRouter()
  const pathname = usePathname()
  return React.useCallback(() => router.push(signInHref(pathname)), [router, pathname])
}
