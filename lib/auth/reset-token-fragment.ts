/**
 * Reads a token from the fragment of an emailed MatchBase link
 * (`/reset-password#token=…`, `/verify-email#token=…`; lib/auth/reset-link.ts
 * builds them). Pure, so the browser forms and the tests share it: exactly
 * one `token` parameter of the expected shape, or null for anything else
 * (missing, empty, extra parameters, odd characters).
 */

/** The shape of a token MatchBase accepts in a reset link: Better Auth issues 24 alphanumerics. */
export const RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,256}$/
/** Better Auth's verification token is a compact HS256 JWT: three base64url segments. */
export const VERIFICATION_TOKEN_PATTERN = /^(?=.{20,2000}$)[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

export function readTokenFromHash(hash: string, pattern: RegExp): string | null {
  const match = /^#token=([^&#]*)$/.exec(hash)
  return match && pattern.test(match[1]) ? match[1] : null
}

export function readResetTokenFromHash(hash: string): string | null {
  return readTokenFromHash(hash, RESET_TOKEN_PATTERN)
}

export function readVerificationTokenFromHash(hash: string): string | null {
  return readTokenFromHash(hash, VERIFICATION_TOKEN_PATTERN)
}
