/**
 * Password length bounds, shared by the auth server configuration and the
 * sign-up form so the browser hint and the server rule cannot drift. The
 * server is authoritative; the form only avoids a round trip.
 */
export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 128
