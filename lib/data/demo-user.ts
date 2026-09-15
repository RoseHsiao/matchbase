/**
 * The single deterministic development user (decisions: Phase 2 user state).
 *
 * Shared by the server-side resolver in lib/data/current-user.ts and by the
 * seed, which creates this user and its demo follows. Not server-only because
 * the seed runs outside the React server runtime; the constant carries no
 * secret.
 */
export const DEMO_USER_ID = "demo-user"
export const DEMO_USER_EMAIL = "guest@matchbase.app"
export const DEMO_USER_NAME = "Guest"
