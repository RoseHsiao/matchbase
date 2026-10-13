import { randomBytes } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { resolveRuntimeEnvironment, type EnvLike } from "@/lib/env/runtime-environment"
import { invalidMessageReason, invalidMessageResult, type Mailer, type MailMessage, type MailResult } from "@/lib/mail/mailer"

/**
 * Local development outbox: instead of sending, each message is written as
 * a file under `.mail-outbox/` (git-ignored) so a developer can open it, and
 * a single line naming the file is printed. The terminal never shows the
 * recipient or the body; anything secret inside a message (a reset link)
 * stays in a file on the developer's own disk.
 *
 * Refuses to be constructed unless the runtime environment is development
 * (never Vercel Preview or Production, never NODE_ENV=production), which
 * repeats the check mail-env.ts already makes, because this is the boundary.
 */

export const DEFAULT_DEV_OUTBOX_DIR = ".mail-outbox"

export type DevOutboxOptions = {
  from: string
  replyTo?: string
  env?: EnvLike
  /** Directory for the files; tests pass a temporary one. */
  dir?: string
  /** Where the one-line notice goes; tests capture it. */
  log?: (line: string) => void
}

export function createDevOutboxMailer(options: DevOutboxOptions): Mailer {
  const environment = resolveRuntimeEnvironment(options.env ?? process.env)
  if (environment !== "development") throw new Error(`The development mail outbox is refused in the ${environment} environment.`)
  const dir = path.resolve(options.dir ?? DEFAULT_DEV_OUTBOX_DIR)
  const log = options.log ?? ((line: string) => console.info(line))

  return {
    transport: "dev-outbox",
    async send(message: MailMessage): Promise<MailResult> {
      if (invalidMessageReason(message)) return invalidMessageResult("dev-outbox")
      const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${message.kind}-${randomBytes(4).toString("hex")}`
      const record = { id, kind: message.kind, from: options.from, replyTo: options.replyTo ?? null, to: message.to, subject: message.subject, text: message.text, html: message.html ?? null }
      try {
        await mkdir(dir, { recursive: true })
        await writeFile(path.join(dir, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
        if (message.html) await writeFile(path.join(dir, `${id}.html`), message.html, { mode: 0o600 })
      } catch {
        return { status: "failed", transport: "dev-outbox", category: "transport-error", retryable: false }
      }
      log(`[mail] dev-outbox kind=${message.kind} written to ${path.join(path.relative(process.cwd(), dir) || ".", `${id}.json`)}`)
      return { status: "sent", transport: "dev-outbox", providerMessageId: id }
    },
  }
}
