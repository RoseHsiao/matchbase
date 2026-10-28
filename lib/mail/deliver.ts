import { describeMailResult, type Mailer, type MailMessage, type MailResult } from "@/lib/mail/mailer"

/**
 * Sends one message and logs exactly one outcome line (`describeMailResult`):
 * kind, transport, status, category, provider id. Never the recipient, the
 * subject, the body or anything inside it. Used by the auth hooks, which have
 * no other place to report a result; it never throws.
 */
export async function deliverAndLog(mailer: Mailer, message: MailMessage, log: (line: string) => void = (line) => console.info(line)): Promise<MailResult> {
  let result: MailResult
  try {
    result = await mailer.send(message)
  } catch {
    // Mailers do not throw; this guards a future one that does without letting its message reach a log.
    result = { status: "failed", transport: mailer.transport, category: "transport-error", retryable: false }
  }
  log(describeMailResult(message.kind, result))
  return result
}
