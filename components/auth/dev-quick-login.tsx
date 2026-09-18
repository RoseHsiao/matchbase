"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ShieldCheckIcon, UserRoundIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { devQuickSignIn } from "@/lib/auth/dev-login-actions"
import type { DevRole } from "@/lib/auth/dev-login"

type DevQuickLoginProps = {
  accounts: { role: DevRole; email: string }[]
  /** Same-origin path to return to, already validated on the server. */
  next: string
}

/**
 * Rendered by the sign-in page only when `resolveDevLogin` allowed it on
 * the server. Each button runs the real sign-in for one development account.
 */
export function DevQuickLogin({ accounts, next }: DevQuickLoginProps) {
  const router = useRouter()
  const [pending, setPending] = React.useState<DevRole | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function signIn(role: DevRole) {
    setError(null)
    setPending(role)
    const result = await devQuickSignIn(role)
    if (!result.ok) {
      setError(result.error)
      setPending(null)
      return
    }
    router.push(next)
    router.refresh()
  }

  return (
    <Card className="w-full max-w-sm border-dashed" size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Development quick sign-in</CardTitle>
        <CardDescription>Local only (MATCHBASE_DEV_LOGIN). Signs in through the normal Better Auth path with the accounts from your environment.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {accounts.map((account) => (
          <Button
            key={account.role}
            type="button"
            variant="outline"
            size="sm"
            className="justify-start"
            disabled={pending !== null}
            onClick={() => void signIn(account.role)}
          >
            {account.role === "ADMIN" ? <ShieldCheckIcon data-icon="inline-start" /> : <UserRoundIcon data-icon="inline-start" />}
            {pending === account.role ? "Signing in…" : `Sign in as dev ${account.role}`}
            <span className="ml-auto truncate text-xs font-normal text-muted-foreground">{account.email}</span>
          </Button>
        ))}
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
