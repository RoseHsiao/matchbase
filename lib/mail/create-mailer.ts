import type { EnvLike } from "@/lib/env/runtime-environment"
import type { Mailer } from "@/lib/mail/mailer"
import type { MailEnvConfig } from "@/lib/mail/mail-env"
import { withRecipientPolicy } from "@/lib/mail/recipient-policy"
import { createDevOutboxMailer } from "@/lib/mail/transports/dev-outbox"
import { createDisabledMailer } from "@/lib/mail/transports/disabled"
import { createResendMailer } from "@/lib/mail/transports/resend"

/**
 * Turns a parsed mail configuration (lib/mail/mail-env.ts) into the one
 * Mailer the application uses. The capture transport is deliberately not
 * reachable from here: tests construct it themselves.
 */

export type CreateMailerDeps = {
  /** Passed to the Resend transport; tests inject a stub. */
  fetch?: typeof fetch
  devOutboxDir?: string
  /** The environment the dev outbox re-checks at its boundary; the configuration was read from the same one. */
  env?: EnvLike
}

export function createMailer(config: MailEnvConfig, deps: CreateMailerDeps = {}): Mailer {
  const transport = config.transport
  switch (transport.kind) {
    case "disabled":
      return createDisabledMailer(transport.reason)
    case "dev-outbox":
      return createDevOutboxMailer({ from: transport.from, replyTo: transport.replyTo, env: deps.env ?? process.env, dir: deps.devOutboxDir })
    case "resend":
      return withRecipientPolicy(createResendMailer({ apiKey: transport.apiKey, from: transport.from, replyTo: transport.replyTo, fetch: deps.fetch }), transport.recipients)
  }
}
