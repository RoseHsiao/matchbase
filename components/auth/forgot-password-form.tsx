"use client"

import * as React from "react"
import Link from "next/link"

import { AuthCard } from "@/components/auth/auth-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient, describeAuthError } from "@/lib/auth/client"

type ForgotPasswordFormProps = {
  /** False when this deployment has no self-service recovery (no mail transport, or the switch is off). */
  available: boolean
  /** Link lifetime for the confirmation text, from the shared constant. */
  lifetimeMinutes: number
}

const linkClass = "font-medium text-foreground underline-offset-4 hover:underline"

/**
 * Request a reset link. The confirmation is the same whether or not the
 * address has an account, and it is worded conditionally ("if an account
 * exists"), because the server answers identically for both and may not
 * have been able to send. Errors that are not about the address (rate limit,
 * network) are shown as errors, never as a confirmation.
 */
export function ForgotPasswordForm({ available, lifetimeMinutes }: ForgotPasswordFormProps) {
  const [state, setState] = React.useState<"idle" | "pending" | "done">("idle")
  const [error, setError] = React.useState<string | null>(null)

  if (!available) {
    return (
      <AuthCard title="Password reset is not available" description="This deployment cannot send password reset emails." footer={<Link href="/sign-in" className={linkClass}>Back to sign in</Link>}>
        <p className="text-sm text-muted-foreground">To regain access to your account, contact the operator of this deployment, who can set a new password for you.</p>
      </AuthCard>
    )
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("Enter a valid email address.")
    setState("pending")
    const result = await authClient.requestPasswordReset({ email })
    if (result.error) {
      setError(describeAuthError(result.error))
      setState("idle")
      return
    }
    setState("done")
  }

  if (state === "done") {
    return (
      <AuthCard title="Check your email" description="If an account exists for that address, a reset link is on its way." footer={<Link href="/sign-in" className={linkClass}>Back to sign in</Link>}>
        <div className="grid gap-2 text-sm text-muted-foreground" role="status">
          <p>The link expires in {lifetimeMinutes} minutes and can be used once. If nothing arrives within a few minutes, check your spam folder or request another link.</p>
          <Button type="button" variant="outline" onClick={() => setState("idle")}>
            Request another link
          </Button>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Reset your password" description="Enter the email address of your account and we'll send you a link to choose a new password." footer={<Link href="/sign-in" className={linkClass}>Back to sign in</Link>}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <div className="grid gap-2">
          <Label htmlFor="forgot-email">Email</Label>
          <Input id="forgot-email" name="email" type="email" autoComplete="email" required autoFocus aria-describedby={error ? "forgot-error" : undefined} aria-invalid={error ? true : undefined} />
        </div>
        {error ? (
          <p id="forgot-error" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={state === "pending"} className="w-full">
          {state === "pending" ? "Sending…" : "Send reset link"}
        </Button>
      </form>
    </AuthCard>
  )
}
