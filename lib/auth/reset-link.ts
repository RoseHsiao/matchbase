import { readTokenFromHash, RESET_TOKEN_PATTERN, VERIFICATION_TOKEN_PATTERN } from "@/lib/auth/reset-token-fragment"

/**
 * The emailed links (password reset, and email verification from 10.7),
 * built and checked in one place and kept apart from email rendering
 * (lib/mail/templates).
 *
 * Shape: `<base URL>/reset-password#token=<token>` and
 * `<base URL>/verify-email#token=<token>`. The token travels in
 * the fragment, which browsers never send to a server, so it stays out of
 * Vercel request logs and Referer headers, and a link scanner that fetches
 * the URL cannot consume it (docs/security/account-recovery.md). The page
 * reads the fragment and posts the token; only that POST uses it.
 *
 * The base URL must be https, except plain http on a loopback host for
 * local development. Pure: no environment, no logging.
 */

export const RESET_PASSWORD_PATH = "/reset-password"
export const VERIFY_EMAIL_PATH = "/verify-email"
export const MAX_RESET_URL_LENGTH = 2048

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"])

function acceptableOrigin(url: URL): boolean {
  if (url.username || url.password) return false
  if (url.protocol === "https:") return true
  return url.protocol === "http:" && LOOPBACK.has(url.hostname)
}

function buildLink(baseURL: string, path: string, token: string, pattern: RegExp): string | null {
  if (!pattern.test(token)) return null
  let base: URL
  try {
    base = new URL(baseURL)
  } catch {
    return null
  }
  if (!acceptableOrigin(base) || base.search || base.hash) return null
  const href = `${base.origin}${base.pathname.replace(/\/+$/, "")}${path}#token=${token}`
  return href.length <= MAX_RESET_URL_LENGTH ? href : null
}

function normalizeLink(value: string, path: string, pattern: RegExp): string | null {
  if (typeof value !== "string" || value.length > MAX_RESET_URL_LENGTH || /[\s\x00-\x1f\x7f"'<>\\`]/.test(value)) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (!acceptableOrigin(url) || url.search) return null
  if (!url.pathname.endsWith(path)) return null
  if (!readTokenFromHash(url.hash, pattern)) return null
  return url.href
}

/** The reset link for `token`, or null when the base URL or the token is not acceptable. */
export function buildPasswordResetUrl(baseURL: string, token: string): string | null {
  return buildLink(baseURL, RESET_PASSWORD_PATH, token, RESET_TOKEN_PATTERN)
}

/** The verification link for `token` (a Better Auth JWT), or null when not acceptable. */
export function buildEmailVerificationUrl(baseURL: string, token: string): string | null {
  return buildLink(baseURL, VERIFY_EMAIL_PATH, token, VERIFICATION_TOKEN_PATTERN)
}

/**
 * The normalised href when `value` is a reset link of the shape above:
 * acceptable origin, no credentials, no query string, the reset path, and a
 * fragment holding exactly one well-formed token. Otherwise null.
 */
export function normalizePasswordResetUrl(value: string): string | null {
  return normalizeLink(value, RESET_PASSWORD_PATH, RESET_TOKEN_PATTERN)
}

/** The same check for a verification link. */
export function normalizeEmailVerificationUrl(value: string): string | null {
  return normalizeLink(value, VERIFY_EMAIL_PATH, VERIFICATION_TOKEN_PATTERN)
}
