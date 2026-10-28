"use client"

import * as React from "react"
import Link from "next/link"

import { AuthCard } from "@/components/auth/auth-card"
import { buttonVariants } from "@/components/ui/button"
import { describeAuthError } from "@/lib/auth/client"
import { readVerificationTokenFromHash } from "@/lib/auth/reset-token-fragment"

type Phase = "reading" | "verified" | "already" | "invalid" | "failed"

/**
 * Confirms an address from the emailed `/verify-email#token=…` link. As on
 * the reset page, the token is read from the fragment once, kept in a ref,
 * and removed from the address bar before the request; it travels only in
 * the body of `POST /api/auth/verify-email`, never in a URL. Opening the
 * link changes nothing but the address's confirmed state: it does not sign
 * anyone in.
 */
export function VerifyEmailForm() {
  const [phase, setPhase] = React.useState<Phase>("reading")
  const [message, setMessage] = React.useState<string | null>(null)
  const handled = React.useRef(false)

  React.useEffect(() => {
    // Reads a browser-only value after hydration, and again when another link is opened in this tab
    // (a fragment change does not reload the page). Once a link was handled, an empty fragment is the
    // URL this component cleaned, not a missing link.
    async function onLink() {
      const hash = window.location.hash
      if (!hash) {
        if (!handled.current) setPhase("invalid")
        return
      }
      handled.current = true
      const token = readVerificationTokenFromHash(hash)
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`)
      setMessage(null)
      if (!token) return setPhase("invalid")
      setPhase("reading")
      try {
        const response = await fetch("/api/auth/verify-email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }), credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer" })
        const body = (await response.json().catch(() => ({}))) as { status?: string; code?: string }
        if (response.ok && body.status === "verified") return setPhase("verified")
        if (body.code === "TOKEN_ALREADY_USED") return setPhase("already")
        setMessage(describeAuthError({ code: body.code, status: response.status }))
        setPhase(response.status === 429 ? "failed" : "invalid")
      } catch {
        setMessage("Something went wrong. Please try again.")
        setPhase("failed")
      }
    }
    const listener = () => void onLink()
    void onLink()
    window.addEventListener("hashchange", listener)
    return () => window.removeEventListener("hashchange", listener)
  }, [])

  const signIn = (
    <Link href="/sign-in" className={buttonVariants({ className: "w-full" })}>
      Sign in
    </Link>
  )

  if (phase === "reading") {
    return (
      <AuthCard title="Confirming your email" description="One moment.">
        <p className="text-sm text-muted-foreground" role="status">
          Checking your confirmation link…
        </p>
      </AuthCard>
    )
  }
  if (phase === "verified") {
    return (
      <AuthCard title="Email confirmed" description="Your address is confirmed.">
        <div role="status" className="grid gap-3">
          <p className="text-sm text-muted-foreground">You can sign in now.</p>
          {signIn}
        </div>
      </AuthCard>
    )
  }
  if (phase === "already") {
    return (
      <AuthCard title="Already confirmed" description={describeAuthError({ code: "TOKEN_ALREADY_USED" })}>
        {signIn}
      </AuthCard>
    )
  }
  return (
    <AuthCard title="This confirmation link can't be used" description={message ?? "The link is incomplete. Open it again from the email."}>
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">Signing in sends a new confirmation link when your address still needs one.</p>
        {signIn}
      </div>
    </AuthCard>
  )
}
