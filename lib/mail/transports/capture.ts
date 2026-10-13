import { resolveRuntimeEnvironment, type EnvLike } from "@/lib/env/runtime-environment"
import { invalidMessageReason, invalidMessageResult, type Mailer, type MailMessage, type MailResult } from "@/lib/mail/mailer"

/**
 * Test-only in-memory transport: records every message so a test can read
 * the link or text it contains, and can be told what to answer so callers'
 * handling of failures is testable without a provider.
 *
 * It is not a value of MAIL_TRANSPORT, so configuration can never select
 * it, and it refuses to be constructed in a production environment.
 */

export type CaptureMailer = Mailer & {
  readonly messages: readonly MailMessage[]
  /** The answer for the following sends; `sent` by default. */
  respondWith(result: MailResult | ((message: MailMessage) => MailResult)): void
  clear(): void
}

export function createCaptureMailer(env: EnvLike = process.env): CaptureMailer {
  if (resolveRuntimeEnvironment(env) === "production") throw new Error("The capture mail transport is for tests and cannot run in production.")
  const messages: MailMessage[] = []
  let respond: (message: MailMessage) => MailResult = () => ({ status: "sent", transport: "capture" })

  return {
    transport: "capture",
    messages,
    async send(message: MailMessage): Promise<MailResult> {
      if (invalidMessageReason(message)) return invalidMessageResult("capture")
      const result = respond(message)
      // A copy, so a caller mutating its object afterwards cannot change what the test inspects.
      if (result.status === "sent") messages.push({ ...message })
      return result
    },
    respondWith(result) {
      respond = typeof result === "function" ? result : () => result
    },
    clear() {
      messages.length = 0
    },
  }
}
