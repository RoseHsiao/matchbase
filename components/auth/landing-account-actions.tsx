import Link from "next/link"
import { ArrowRightIcon } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"

/**
 * The landing page's calls to action and the account note under them. With
 * public sign-up open it offers "Create account" and says what an account is
 * for; closed, it keeps the "authorized users" wording. `signUpOpen` comes
 * from accountPolicy on the server; the auth server enforces the same policy.
 */
export function LandingAccountActions({ signUpOpen }: { signUpOpen: boolean }) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Link href="/dashboard" className={buttonVariants({ size: "lg" })}>
          Explore Demo
          <ArrowRightIcon data-icon="inline-end" />
        </Link>
        {signUpOpen ? (
          <Link href="/sign-up" className={buttonVariants({ variant: "outline", size: "lg" })}>
            Create account
          </Link>
        ) : null}
        <Link href="/sign-in" className={buttonVariants({ variant: signUpOpen ? "ghost" : "outline", size: "lg" })}>
          Sign in
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">
        {signUpOpen
          ? "A free account lets you follow teams and players, keep a watchlist and set reminders. "
          : "Accounts are limited to authorized users. "}
        Any resemblance between demo data and real teams or people is coincidental.
      </p>
    </>
  )
}
