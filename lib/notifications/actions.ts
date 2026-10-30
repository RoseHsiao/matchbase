"use server"

import { refresh } from "next/cache"

import { isAuthorizationError } from "@/lib/auth/authorization"
import { requireUser } from "@/lib/auth/session"
import { db } from "@/lib/data/db"
import { reminderEmailsAvailable, setReminderEmails, type SetReminderEmailsResult } from "@/lib/notifications/preferences-ops"

/**
 * The signed-in user's email-reminder switch. The viewer is resolved from the
 * session before anything else, and the row written is always the session's
 * user, never an id from the browser (same rule as lib/data/user-state-actions.ts).
 */
export async function setReminderEmailsEnabled(enabled: boolean): Promise<SetReminderEmailsResult> {
  try {
    const viewer = await requireUser()
    const result = await setReminderEmails(db, viewer.id, enabled, reminderEmailsAvailable(process.env))
    if (result.ok) refresh()
    return result
  } catch (error) {
    if (isAuthorizationError(error)) return { ok: false, error: error.message }
    throw error
  }
}
