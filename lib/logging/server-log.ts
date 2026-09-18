import { redactSensitiveText } from "@/lib/data/sync/redaction"
import { resolveRuntimeEnvironment, type EnvLike } from "@/lib/env/runtime-environment"

/**
 * The one way server code reports an unexpected error to the operator log.
 *
 * What is printed: a scope, the error's class name and its message after the
 * same redaction the sync logs use (secret values from the environment,
 * connection-string passwords, bearer tokens, key-like query parameters).
 * Stack traces are printed only outside production, where they are useful
 * and the audience is the developer. Nothing here is ever sent to a client;
 * the caller returns its own safe message.
 */

const MAX_MESSAGE_LENGTH = 600

export function describeErrorForOperator(error: unknown, env: EnvLike = process.env): string {
  const name = error instanceof Error ? error.name : typeof error
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error)
  const message = redactSensitiveText((raw ?? "").replace(/\s+/g, " ").trim(), env)
  const clipped = message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : message
  return `${name}: ${clipped || "(no message)"}`
}

export function logServerError(scope: string, error: unknown, env: EnvLike = process.env): void {
  const line = `[${scope}] ${describeErrorForOperator(error, env)}`
  if (resolveRuntimeEnvironment(env) === "production") {
    console.error(line)
    return
  }
  const stack = error instanceof Error && error.stack ? redactSensitiveText(error.stack, env) : undefined
  console.error(line, stack ? `\n${stack}` : "")
}
