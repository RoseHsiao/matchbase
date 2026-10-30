"use client"

import * as React from "react"
import { MailIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { authClient, describeAuthError } from "@/lib/auth/client"
import { setReminderEmailsEnabled } from "@/lib/notifications/actions"
import { reminderSettingsState } from "@/lib/notifications/reminder-settings-view"

type ReminderEmailSettingsProps = {
  /** This deployment has a mail transport. */
  available: boolean
  email: string
  confirmed: boolean
  enabled: boolean
}

/**
 * Opt-in for email delivery of watchlist reminders. Reminders are always
 * shown in the app; email is extra, off by default, and only for a confirmed
 * address on a deployment that can send mail. Each state says plainly what
 * will and will not happen.
 */
export function ReminderEmailSettings({ available, email, confirmed, enabled }: ReminderEmailSettingsProps) {
  const [on, setOn] = React.useState(enabled)
  const [pending, setPending] = React.useState(false)
  const [message, setMessage] = React.useState<{ tone: "info" | "error"; text: string } | null>(null)

  async function toggle() {
    setPending(true)
    setMessage(null)
    const result = await setReminderEmailsEnabled(!on)
    setPending(false)
    if (result.ok) setOn(result.enabled)
    else setMessage({ tone: "error", text: result.error })
  }

  async function sendConfirmation() {
    setPending(true)
    setMessage(null)
    const result = await authClient.sendVerificationEmail({ email })
    setPending(false)
    setMessage(result.error ? { tone: "error", text: describeAuthError(result.error) } : { tone: "info", text: "Confirmation link sent. Open it from your inbox, then come back here." })
  }

  const state = reminderSettingsState({ available, confirmed, enabled: on })
  const switchButton = (
    <Button type="button" variant={on ? "outline" : "default"} size="sm" role="switch" aria-checked={on} aria-describedby="reminder-email-status" disabled={pending} onClick={toggle}>
      {pending ? "Saving…" : on ? "Turn off email reminders" : "Email me my reminders"}
    </Button>
  )

  let body: React.ReactNode
  if (state === "off-unavailable") {
    body = <p className="text-sm text-muted-foreground">Email delivery isn&apos;t available on this deployment. Your reminders still appear in the app under the bell.</p>
  } else if (state === "on-not-delivering") {
    // Opted in, but nothing is emailed right now: say so, and keep the way out.
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" id="reminder-email-status">
          {available ? `Email reminders are on, but ${email} isn't confirmed, so none are sent.` : "Email reminders are on, but email delivery isn't available on this deployment right now, so none are sent."} Your reminders still appear in the app.
        </p>
        {switchButton}
      </div>
    )
  } else if (state === "unconfirmed") {
    body = (
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">Confirm {email} to receive reminders by email.</p>
        <Button type="button" variant="outline" size="sm" className="justify-self-start" disabled={pending} onClick={sendConfirmation}>
          {pending ? "Sending…" : "Send confirmation link"}
        </Button>
      </div>
    )
  } else {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" id="reminder-email-status">
          {state === "on" ? `Reminders are emailed to ${email} at the time you chose for each match.` : `Reminders are shown in the app only.`}
        </p>
        {switchButton}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MailIcon className="size-4" aria-hidden />
          Email reminders
        </CardTitle>
        <CardDescription>Get an email for the reminders you set on saved matches.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {body}
        {message ? (
          <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
            {message.text}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
