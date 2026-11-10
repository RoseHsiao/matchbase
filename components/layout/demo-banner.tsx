"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { useSignUpOpen, useViewer } from "@/components/auth/viewer-provider"
import { buttonVariants } from "@/components/ui/button"
import { signInHrefFromDemo, signUpHrefFromDemo } from "@/lib/auth/redirect"

/**
 * Says plainly that an anonymous visitor is in the demo, not signed in, on
 * every page of the app shell. Offers "Create account" only when the
 * deployment accepts public sign-up.
 */
export function DemoBanner() {
  const viewer = useViewer()
  const signUpOpen = useSignUpOpen()
  const pathname = usePathname()
  if (viewer) return null

  return (
    <aside aria-label="Demo notice" className="flex items-center justify-between gap-3 border-b bg-muted/60 px-4 py-2 text-xs text-muted-foreground">
      <p className="min-w-0">
        <span className="font-medium text-foreground">You&apos;re exploring the demo.</span> The teams, players and results are fictional, it&apos;s read-only, and you&apos;re not signed in.
      </p>
      <div className="flex shrink-0 items-center gap-2">
        {signUpOpen ? (
          <Link href={signUpHrefFromDemo(pathname)} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Create account
          </Link>
        ) : null}
        <Link href={signInHrefFromDemo(pathname)} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Sign in
        </Link>
      </div>
    </aside>
  )
}
