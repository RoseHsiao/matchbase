"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { AuthCard } from "@/components/auth/auth-card"
import { announceAuthChange } from "@/components/auth/session-sync"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient, describeAuthError } from "@/lib/auth/client"
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy"

type SignUpFormProps = {
  /** Same-origin path to return to, already validated on the server. */
  next: string
  /** False when the deployment does not accept sign-up (accountPolicy). */
  allowed: boolean
  /** New accounts must confirm their address before signing in (lib/auth/email-verification.ts). */
  requiresVerification: boolean
  /** Self-service password recovery by email is available (lib/mail/mail-env.ts). */
  recoveryAvailable?: boolean
}

/**
 * Email and password sign-up. Only name, email and password are sent; the
 * role is a server-owned field the auth server refuses from input, so every
 * new account is a regular user. Without verification the form says so
 * before submitting: the address is not checked, and (unless recovery mail
 * is on) a forgotten password cannot be reset by the person themselves.
 */
export function SignUpForm({ next, allowed, requiresVerification, recoveryAvailable = false }: SignUpFormProps) {
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const [awaitingConfirmation, setAwaitingConfirmation] = React.useState(false)
  const signInHref = next === "/dashboard" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}`

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const form = new FormData(event.currentTarget)
    const name = String(form.get("name") ?? "").trim()
    const email = String(form.get("email") ?? "").trim()
    const password = String(form.get("password") ?? "")
    if (name.length === 0) return setError("Enter the name to show in the app.")
    if (password.length < PASSWORD_MIN_LENGTH) return setError(`Use at least ${PASSWORD_MIN_LENGTH} characters for the password.`)
    if (password.length > PASSWORD_MAX_LENGTH) return setError("That password is too long.")
    setPending(true)
    const result = await authClient.signUp.email({ name, email, password })
    if (result.error) {
      setError(describeAuthError(result.error))
      setPending(false)
      return
    }
    // With verification required the server creates no session and answers an existing address
    // exactly like a new one, so the next step is the same for both: check the inbox.
    if (requiresVerification) {
      setAwaitingConfirmation(true)
      return
    }
    // Signed in automatically: tell this browser's other tabs, as a sign-in does.
    announceAuthChange()
    router.push(next)
    router.refresh()
  }

  if (!allowed) {
    return (
      <AuthCard title="Account creation is not open" description="This deployment does not accept public sign-up yet." footer={<Link href={signInHref} className="font-medium text-foreground underline-offset-4 hover:underline">Sign in</Link>}>
        <p className="text-sm text-muted-foreground">Existing accounts can sign in as usual. To get an account, ask the operator of this deployment.</p>
      </AuthCard>
    )
  }

  if (awaitingConfirmation) {
    return (
      <AuthCard title="Check your email" description="Confirm your address to finish creating your account." footer={<Link href={signInHref} className="font-medium text-foreground underline-offset-4 hover:underline">Sign in</Link>}>
        <p className="text-sm text-muted-foreground" role="status">
          If this address can be used for a new account, a confirmation link is on its way. Open it, then sign in. If the address already has an account, sign in or reset its password instead.
        </p>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Create account"
      description="Follow teams and players, save matches and set reminders."
      footer={
        <>
          Already have an account?{" "}
          <Link href={signInHref} className="font-medium text-foreground underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        {requiresVerification ? null : (
          <div role="note" aria-label="About this account" className="grid gap-1 rounded-lg border bg-muted/60 p-3 text-xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Your email address is not verified.</span> MatchBase does not send a confirmation link, so it never checks that the address is yours.
            </p>
            <p>
              {recoveryAvailable
                ? "If you forget your password, you can reset it from the sign-in page."
                : "There is no self-service password reset. Keep your password somewhere safe: if you lose it, only the operator of this deployment can set a new one."}
            </p>
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor="sign-up-name">Name</Label>
          <Input id="sign-up-name" name="name" type="text" autoComplete="name" required maxLength={80} autoFocus />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="sign-up-email">Email</Label>
          <Input id="sign-up-email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="sign-up-password">Password</Label>
          <Input id="sign-up-password" name="password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} />
          <p className="text-xs text-muted-foreground">At least {PASSWORD_MIN_LENGTH} characters.</p>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthCard>
  )
}
