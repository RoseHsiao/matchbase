import { redactUrl } from "@/lib/data/sync/utils/http"

/**
 * The last line of defence before any sync text is persisted or shown:
 * adapters scrub their own keys and `redactUrl` masks key-like query
 * parameters, but an unexpected error (a driver message with a connection
 * string, a header dump, a stray token) must still never reach SyncLog or
 * Admin. This pass is applied by the sync core to every error and issue
 * text it stores, with the process environment's secret values.
 *
 * Pure: the environment is a parameter, so tests inject their own.
 */

const REDACTED = "[REDACTED]"

/** Environment variables whose values are secrets. Matched by exact name or suffix. */
const SECRET_ENV_PATTERN = /(^|_)(SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY)$|^DATABASE_URL/i

/** Public, non-secret values that must not be redacted even though their variable name matches. */
const PUBLIC_VALUES = new Set(["123"])

/** Values from `env` worth scrubbing: secrets of at least 6 characters, plus passwords embedded in connection strings. */
export function secretValuesFrom(env: Record<string, string | undefined>): string[] {
  const values = new Set<string>()
  for (const [name, value] of Object.entries(env)) {
    if (!value || !SECRET_ENV_PATTERN.test(name)) continue
    const trimmed = value.trim()
    if (trimmed.length >= 6 && !PUBLIC_VALUES.has(trimmed)) values.add(trimmed)
    const password = /^[a-z][a-z0-9+.-]*:\/\/[^:/?#]+:([^@/?#]+)@/i.exec(trimmed)?.[1]
    if (password && password.length >= 4) values.add(decodeURIComponent(password))
  }
  return [...values].sort((a, b) => b.length - a.length)
}

const CONNECTION_STRING = /\b([a-z][a-z0-9+.-]*:\/\/)([^:/?#\s]+):([^@/?#\s]+)@/gi
const AUTHORIZATION = /(authorization\s*[:=]\s*)(bearer|basic|token)?\s*([^\s,;"']+)/gi
const API_KEY_HEADER = /((?:x-api-key|api[-_]?key|apikey|x-auth-token|x-cron-secret)\s*[:=]\s*)([^\s,;"']+)/gi
const BEARER = /\b(bearer\s+)([A-Za-z0-9._~+/=-]{8,})/gi
const URL = /\bhttps?:\/\/[^\s"'<>]+/gi

/** Scrubs credentials from free text: known secret values, connection-string passwords, auth headers, bearer tokens, key-like query parameters. */
export function redactSensitiveText(text: string, env: Record<string, string | undefined> = {}): string {
  let out = text
  for (const secret of secretValuesFrom(env)) out = out.split(secret).join(REDACTED)
  out = out.replace(CONNECTION_STRING, (_, scheme, user) => `${scheme}${user}:${REDACTED}@`)
  out = out.replace(AUTHORIZATION, (_, prefix, scheme) => `${prefix}${scheme ? `${scheme} ` : ""}${REDACTED}`)
  out = out.replace(API_KEY_HEADER, (_, prefix) => `${prefix}${REDACTED}`)
  out = out.replace(BEARER, (_, prefix) => `${prefix}${REDACTED}`)
  out = out.replace(URL, (url) => redactUrl(url))
  return out
}
