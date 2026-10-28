"use client"

import * as React from "react"
import Link from "next/link"

import { AuthCard } from "@/components/auth/auth-card"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient, describeAuthError } from "@/lib/auth/client"
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy"
import { readResetTokenFromHash } from "@/lib/auth/reset-token-fragment"

const linkClass = "font-medium text-foreground underline-offset-4 hover:underline"

type Phase = { kind: "reading" } | { kind: "missing" } | { kind: "ready" } | { kind: "pending" } | { kind: "done" } | { kind: "invalid"; message: string }

/**
 * Choose a new password from the emailed link `/reset-password#token=…`.
 *
 * The token is read from the fragment once, on the client, kept only in a
 * ref (never rendered, never in state that reaches the DOM), and the
 * fragment is removed from the address bar with `history.replaceState`
 * before anything else happens, so it does not survive in the URL, history
 * entries a later page could read, or a copy-pasted link. The server never
 * sees it except in the body of the one POST that consumes it
 * (`authClient.resetPassword` → `/api/auth/reset-password`).
 */
export function ResetPasswordForm() {
  const token = React.useRef<string | null>(null)
  const [phase, setPhase] = React.useState<Phase>({ kind: "reading" })
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    // A browser-only value read after hydration (the server render cannot know it), and again when
    // another link is opened in this tab: that is a fragment change, which does not reload the page.
    function read() {
      if (!window.location.hash && token.current !== null) return
      token.current = readResetTokenFromHash(window.location.hash)
      if (window.location.hash) window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`)
      setError(null)
      setPhase(token.current ? { kind: "ready" } : { kind: "missing" })
    }
    read()
    window.addEventListener("hashchange", read)
    return () => window.removeEventListener("hashchange", read)
  }, [])

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const form = new FormData(event.currentTarget)
    const password = String(form.get("password") ?? "")
    const confirm = String(form.get("confirm") ?? "")
    if (password.length < PASSWORD_MIN_LENGTH) return setError(`Use at least ${PASSWORD_MIN_LENGTH} characters for the password.`)
    if (password.length > PASSWORD_MAX_LENGTH) return setError("That password is too long.")
    if (password !== confirm) return setError("The two passwords do not match.")
    if (!token.current) return setPhase({ kind: "missing" })
    setPhase({ kind: "pending" })
    const result = await authClient.resetPassword({ newPassword: password, token: token.current })
    if (result.error) {
      if (result.error.code === "INVALID_TOKEN" || result.error.code === "TOKEN_EXPIRED") {
        token.current = null
        setPhase({ kind: "invalid", message: describeAuthError(result.error) })
        return
      }
      setError(describeAuthError(result.error))
      setPhase({ kind: "ready" })
      return
    }
    token.current = null
    setPhase({ kind: "done" })
  }

  if (phase.kind === "reading") {
    return (
      <AuthCard title="Choose a new password" description="Checking your reset link…">
        <p className="text-sm text-muted-foreground" role="status">
          One moment.
        </p>
      </AuthCard>
    )
  }

  if (phase.kind === "missing" || phase.kind === "invalid") {
    return (
      <AuthCard title="This reset link can't be used" description={phase.kind === "invalid" ? phase.message : "The link is incomplete. Open it again from the email, or request a new one."} footer={<Link href="/sign-in" className={linkClass}>Back to sign in</Link>}>
        <Link href="/forgot-password" className={buttonVariants({ className: "w-full" })}>
          Request a new link
        </Link>
      </AuthCard>
    )
  }

  if (phase.kind === "done") {
    return (
      <AuthCard title="Password changed" description="Your password was changed and you were signed out everywhere.">
        <div role="status" className="grid gap-3">
          <p className="text-sm text-muted-foreground">Sign in with your new password to continue.</p>
          <Link href="/sign-in" className={buttonVariants({ className: "w-full" })}>
            Sign in
          </Link>
        </div>
      </AuthCard>
    )
  }

  const pending = phase.kind === "pending"
  return (
    <AuthCard title="Choose a new password" description={`Use at least ${PASSWORD_MIN_LENGTH} characters. Every device signed in to your account will be signed out.`} footer={<Link href="/sign-in" className={linkClass}>Back to sign in</Link>}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <div className="grid gap-2">
          <Label htmlFor="reset-password">New password</Label>
          <Input id="reset-password" name="password" type="password" autoComplete="new-password" required autoFocus minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} aria-describedby="reset-password-hint" />
          <p id="reset-password-hint" className="text-xs text-muted-foreground">
            {PASSWORD_MIN_LENGTH} to {PASSWORD_MAX_LENGTH} characters.
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="reset-confirm">Confirm new password</Label>
          <Input id="reset-confirm" name="confirm" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Saving…" : "Set new password"}
        </Button>
      </form>
    </AuthCard>
  )
}
