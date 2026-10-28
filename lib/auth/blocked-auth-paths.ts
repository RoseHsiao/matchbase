/**
 * Better Auth endpoints MatchBase never uses and refuses at its own route
 * boundary, because they carry a token in a URL that a GET request would
 * write into platform request logs, browser history and Referer headers:
 *
 * - `GET /reset-password/:token`: Better Auth's emailed link, which
 *   redirects to the page with `?token=…`. MatchBase mails
 *   `/reset-password#token=…` instead (lib/auth/reset-link.ts), and the page
 *   POSTs the token to `/reset-password`, which stays open.
 * - `GET /verify-email?token=…`: Better Auth's verification endpoint. MatchBase
 *   mails `/verify-email#token=…` and the page POSTs the token to
 *   `/api/auth/verify-email`, which the route hands to Better Auth in-process
 *   (lib/auth/email-verification.ts, `verifyEmailToken`).
 *
 * Better Auth's own `disabledPaths` option compares exact paths, so it cannot
 * express the parameterised path; the check lives here instead and is pure
 * so it is unit-tested.
 */

const BLOCKED_GET = [/^\/reset-password\/[^/]+\/?$/, /^\/verify-email\/?$/]

/** True when this request must be answered 404 before Better Auth sees it. `authPath` is the path below the auth base path. */
export function isBlockedAuthRequest(method: string, authPath: string): boolean {
  if (method.toUpperCase() !== "GET") return false
  return BLOCKED_GET.some((pattern) => pattern.test(authPath))
}

export const AUTH_BASE_PATH = "/api/auth"

export function authPathOf(url: string): string | null {
  try {
    const { pathname } = new URL(url)
    return pathname === AUTH_BASE_PATH || pathname.startsWith(`${AUTH_BASE_PATH}/`) ? pathname.slice(AUTH_BASE_PATH.length) || "/" : null
  } catch {
    return null
  }
}
