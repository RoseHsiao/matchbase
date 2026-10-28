import type { WatchlistReminder } from "@/lib/data/types"
import { formatKickoffWithZone } from "@/lib/format"
import type { MailMessage } from "@/lib/mail/mailer"
import { greetingName } from "@/lib/mail/templates/display-name"
import { BRAND_NAME, renderHtml, renderText, type EmailBlock, type EmailContent } from "@/lib/mail/templates/render"
import { reminderOption } from "@/lib/reminders"

/**
 * The match reminder email (Phase 11). Inputs are the minimum the message
 * needs: the recipient, an optional display name, the match title and
 * league as the app shows them, the absolute start, the reminder offset and
 * an optional link to the match page. Match names come from provider data,
 * so they are cleaned like display names (control characters out, length
 * capped) and, as everywhere, escaped by the renderer.
 *
 * The start is written with its zone spelled out ("… GMT+8 (Asia/Taipei)"):
 * the app presents one zone, and a reader of an email may be anywhere, so
 * the email never pretends the time is the reader's local time.
 */

export const MATCH_REMINDER_KIND = "match-reminder"
const MAX_NAME = 120
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"])

export type MatchReminderInput = {
  to: string
  name?: string | null
  matchTitle: string
  leagueName?: string | null
  startsAt: Date
  reminder: Exclude<WatchlistReminder, "off">
  /** The match page; omitted when the deployment has no base URL. */
  matchUrl?: string | null
}

function clean(value: string | null | undefined): string {
  const text = (value ?? "").normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, " ").replace(/\s+/g, " ").trim()
  return Array.from(text).length > MAX_NAME ? `${Array.from(text).slice(0, MAX_NAME - 1).join("").trimEnd()}…` : text
}

/** "starts in 15 minutes", "starts in 1 hour", "is starting now". */
export function reminderPhrase(reminder: Exclude<WatchlistReminder, "off">): string {
  const minutes = Math.round((reminderOption(reminder).offsetMs ?? 0) / 60_000)
  if (minutes === 0) return "is starting now"
  if (minutes % 1440 === 0) return `starts in ${minutes / 1440 === 1 ? "1 day" : `${minutes / 1440} days`}`
  if (minutes % 60 === 0) return `starts in ${minutes / 60 === 1 ? "1 hour" : `${minutes / 60} hours`}`
  return `starts in ${minutes} minutes`
}

/** A match page URL on an https origin (or loopback http), or null. */
export function safeMatchUrl(value: string | null | undefined): string | null {
  if (!value || /[\s"'<>\\`]/.test(value)) return null
  try {
    const url = new URL(value)
    const originOk = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname))
    if (!originOk || url.username || url.password || url.search || url.hash || !/^\/matches\/[A-Za-z0-9_-]{1,200}$/.test(url.pathname)) return null
    return url.href
  } catch {
    return null
  }
}

export function matchReminderEmail(input: MatchReminderInput): MailMessage {
  const title = clean(input.matchTitle) || "Your match"
  const league = clean(input.leagueName)
  const phrase = reminderPhrase(input.reminder)
  const url = safeMatchUrl(input.matchUrl)
  const blocks: EmailBlock[] = [
    { type: "paragraph", text: `${title}${league ? ` (${league})` : ""} ${phrase}.` },
    { type: "paragraph", text: `Starts: ${formatKickoffWithZone(input.startsAt)}.` },
  ]
  if (url) blocks.push({ type: "action", label: "View match", url })
  blocks.push({ type: "paragraph", text: `You set this reminder on your ${BRAND_NAME} watchlist.` })
  const content: EmailContent = {
    subject: `${title} ${phrase}`,
    heading: "Match reminder",
    greetingName: greetingName(input.name),
    blocks,
    footer: `You're receiving this because email reminders are on for your ${BRAND_NAME} account. You can turn them off on the Watchlist page.`,
  }
  return { kind: MATCH_REMINDER_KIND, to: input.to, subject: content.subject, text: renderText(content), html: renderHtml(content) }
}
