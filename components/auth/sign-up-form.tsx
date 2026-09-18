"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { AuthCard } from "@/components/auth/auth-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient, describeAuthError } from "@/lib/auth/client"
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy"

type SignUpFormProps = {
  /** Same-origin path to return to, already validated on the server. */
  next: string
  /** False when the deployment has closed sign-up (AUTH_ALLOW_SIGN_UP=false). */
  allowed: boolean
}

/**
 * Email and password sign-up. Only name, email and password are sent; the
 * role is a server-owned field the auth server refuses from input, so every
 * new account is a regular user.
 */
export function SignUpForm({ next, allowed }: SignUpFormProps) {
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
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
