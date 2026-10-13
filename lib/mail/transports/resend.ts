import { invalidMessageReason, invalidMessageResult, type Mailer, type MailFailureCategory, type MailMessage, type MailResult } from "@/lib/mail/mailer"

/**
 * Resend over its HTTPS API with the platform `fetch`: no SDK, no new
 * dependency. One POST per message to /emails, a bounded timeout, and an
 * outcome mapped to a provider-neutral `MailResult`.
 *
 * What never leaves this module: the API key (only in the Authorization
 * header), the request payload, and the provider's response text. A failed
 * response body is discarded unread, so a provider error that echoes the
 * recipient or the content cannot reach application code or logs. This
 * module logs nothing; the caller logs `describeMailResult`.
 *
 * No retries here: whether a failed send is retried is the caller's
 * decision (`retryable`), made with the context this module does not have.
 */

export const RESEND_ENDPOINT = "https://api.resend.com/emails"
export const DEFAULT_RESEND_TIMEOUT_MS = 10_000

export type ResendTransportOptions = {
  apiKey: string
  from: string
  replyTo?: string
  timeoutMs?: number
  /** Injectable so tests never touch the network. */
  fetch?: typeof fetch
}

/** Exactly what is POSTed, exported for the request-shape tests. */
export type ResendRequestBody = {
  from: string
  to: [string]
  subject: string
  text: string
  html?: string
  reply_to?: string
  tags: [{ name: "kind"; value: string }]
}

export function buildResendRequest(message: MailMessage, options: Pick<ResendTransportOptions, "apiKey" | "from" | "replyTo">): { url: string; init: RequestInit & { headers: Record<string, string> }; body: ResendRequestBody } {
  const body: ResendRequestBody = {
    from: options.from,
    to: [message.to],
    subject: message.subject,
    text: message.text,
    ...(message.html ? { html: message.html } : {}),
    ...(options.replyTo ? { reply_to: options.replyTo } : {}),
    // Resend tag values allow letters, digits, underscores and dashes; the kind slug is already that.
    tags: [{ name: "kind", value: message.kind }],
  }
  const headers: Record<string, string> = { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" }
  if (message.idempotencyKey) headers["idempotency-key"] = message.idempotencyKey
  return { url: RESEND_ENDPOINT, init: { method: "POST", headers, body: JSON.stringify(body) }, body }
}

export function categorizeResendStatus(status: number): { category: MailFailureCategory; retryable: boolean } {
  if (status === 401 || status === 403) return { category: "auth-config", retryable: false }
  if (status === 429) return { category: "rate-limit", retryable: true }
  if (status >= 500) return { category: "provider-5xx", retryable: true }
  return { category: "provider-4xx", retryable: false }
}

/** Resend ids are UUIDs; anything else is not kept, so a surprising body cannot smuggle text into a log. */
async function readMessageId(response: Response): Promise<string | undefined> {
  try {
    const data: unknown = await response.json()
    const id = data && typeof data === "object" ? (data as { id?: unknown }).id : undefined
    return typeof id === "string" && /^[A-Za-z0-9-]{1,100}$/.test(id) ? id : undefined
  } catch {
    return undefined
  }
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // nothing to release
  }
}

export function createResendMailer(options: ResendTransportOptions): Mailer {
  if (!options.apiKey.trim()) throw new Error("The Resend transport needs an API key.")
  const timeoutMs = options.timeoutMs ?? DEFAULT_RESEND_TIMEOUT_MS
  const transport = options.fetch ?? fetch

  return {
    transport: "resend",
    async send(message: MailMessage): Promise<MailResult> {
      if (invalidMessageReason(message)) return invalidMessageResult("resend")
      const { url, init } = buildResendRequest(message, options)
      let response: Response
      try {
        response = await transport(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
      } catch (error) {
        const name = error instanceof Error ? error.name : ""
        if (name === "TimeoutError" || name === "AbortError") return { status: "failed", transport: "resend", category: "timeout", retryable: true }
        return { status: "failed", transport: "resend", category: "network", retryable: true }
      }
      if (response.ok) return { status: "sent", transport: "resend", providerMessageId: await readMessageId(response) }
      await discard(response)
      return { status: "failed", transport: "resend", ...categorizeResendStatus(response.status), httpStatus: response.status }
    },
  }
}
