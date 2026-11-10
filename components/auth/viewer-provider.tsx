"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"

import type { Viewer } from "@/lib/auth/authorization"
import { signInHrefFromDemo } from "@/lib/auth/redirect"

/**
 * Who the server says is viewing the app, for client components that adapt
 * their wording or controls (the account menu, the personal empty states,
 * the follow and watchlist stores). This is display state only: every
 * authorization decision is made again on the server, and the value here
 * comes from the server render, never from a client-side session read.
 */

const ViewerContext = React.createContext<Viewer | null | undefined>(undefined)
const SignUpOpenContext = React.createContext(false)

export function ViewerProvider({ viewer, signUpOpen = false, children }: { viewer: Viewer | null; signUpOpen?: boolean; children: React.ReactNode }) {
  return (
    <ViewerContext.Provider value={viewer}>
      <SignUpOpenContext.Provider value={signUpOpen}>{children}</SignUpOpenContext.Provider>
    </ViewerContext.Provider>
  )
}

/**
 * Whether this deployment accepts public sign-up (accountPolicy, read by the
 * server render), so the shell can offer "Create account". Display only: the
 * auth server enforces the same policy with `disableSignUp`.
 */
export function useSignUpOpen(): boolean {
  return React.useContext(SignUpOpenContext)
}

/** The viewer, or null for an anonymous visitor. */
export function useViewer(): Viewer | null {
  const viewer = React.useContext(ViewerContext)
  if (viewer === undefined) throw new Error("useViewer must be used within a ViewerProvider.")
  return viewer
}

/** Sends a demo visitor to sign in, and afterwards back to the current page or, from a demo record, its list. */
export function useSignInPrompt(): () => void {
  const router = useRouter()
  const pathname = usePathname()
  return React.useCallback(() => router.push(signInHrefFromDemo(pathname)), [router, pathname])
}
