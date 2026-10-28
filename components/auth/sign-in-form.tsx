"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { AuthCard } from "@/components/auth/auth-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient, describeAuthError } from "@/lib/auth/client"

type SignInFormProps = {
  /** Same-origin path to return to, already validated on the server. */
  next: string
  signUpAllowed: boolean
  /** Shows the "Forgot password?" link; false when this deployment has no self-service recovery. */
  recoveryAvailable: boolean
}

/**
 * Email and password sign-in. The form posts to the auth endpoint through
 * the client; the browser never sees a token (the session cookie is
 * HttpOnly), and on success the router re-renders the tree so the server
 * seeds every store for the signed-in viewer.
 */
export function SignInForm({ next, signUpAllowed, recoveryAvailable }: SignInFormProps) {
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)
    const form = new FormData(event.currentTarget)
    const result = await authClient.signIn.email({
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
    })
    if (result.error) {
      setError(describeAuthError(result.error))
      setPending(false)
      return
    }
    router.push(next)
    router.refresh()
  }

  return (
    <AuthCard
      title="Sign in"
      description="Your follows, watchlist and reminders are kept with your account."
      footer={
        signUpAllowed ? (
          <>
            No account yet?{" "}
            <Link href={next === "/dashboard" ? "/sign-up" : `/sign-up?next=${encodeURIComponent(next)}`} className="font-medium text-foreground underline-offset-4 hover:underline">
              Create one
            </Link>
          </>
        ) : (
          "Account creation is not open on this deployment; ask the operator for an account."
        )
      }
    >
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <div className="grid gap-2">
          <Label htmlFor="sign-in-email">Email</Label>
          <Input id="sign-in-email" name="email" type="email" autoComplete="email" required autoFocus />
        </div>
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="sign-in-password">Password</Label>
            {recoveryAvailable ? (
              <Link href="/forgot-password" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                Forgot password?
              </Link>
            ) : null}
          </div>
          <Input id="sign-in-password" name="password" type="password" autoComplete="current-password" required />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthCard>
  )
}
