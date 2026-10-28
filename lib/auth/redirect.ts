/**
 * Post-sign-in destinations. The `next` query parameter comes from the
 * browser, so it is only honoured when it is a same-origin path: one leading
 * slash, no scheme, no protocol-relative `//host`, no backslash tricks, no
 * control characters or whitespace, and never the auth pages themselves.
 */

export const DEFAULT_AFTER_SIGN_IN = "/dashboard"

const UNSAFE_CHARACTERS = /[\x00-\x1f\x7f\s]/

export function safeNextPath(value: unknown, fallback = DEFAULT_AFTER_SIGN_IN): string {
  if (typeof value !== "string") return fallback
  if (value.length === 0 || value.length > 2000) return fallback
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback
  if (UNSAFE_CHARACTERS.test(value)) return fallback
  if (["/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/verify-email", "/api/"].some((prefix) => value.startsWith(prefix))) return fallback
  return value
}

/** The sign-in URL that returns to `next` afterwards. */
export function signInHref(next?: string): string {
  const target = safeNextPath(next)
  return target === DEFAULT_AFTER_SIGN_IN ? "/sign-in" : `/sign-in?next=${encodeURIComponent(target)}`
}
