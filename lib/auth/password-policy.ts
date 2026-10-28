/**
 * Password length bounds, shared by the auth server configuration and the
 * sign-up form so the browser hint and the server rule cannot drift. The
 * server is authoritative; the form only avoids a round trip.
 */
export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 128

/**
 * How long a password-reset link stays usable (Phase 10, decided
 * 2026-10-13). The Better Auth option (10.3) and the email wording both
 * read this constant, so the mail can never promise a different lifetime
 * than the server enforces.
 */
export const PASSWORD_RESET_TOKEN_TTL_SECONDS = 30 * 60

/**
 * How long an email-verification link stays valid (Phase 10.7). Better Auth's
 * `emailVerification.expiresIn` and the email wording both read it.
 */
export const EMAIL_VERIFICATION_TOKEN_TTL_SECONDS = 60 * 60
