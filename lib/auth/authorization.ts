/**
 * Authorization vocabulary and guards, pure and framework-free.
 *
 * The rest of the application speaks only in these terms: a `Viewer` is the
 * person making the request as MatchBase understands them (its own user id,
 * email, display name and role); `null` is an anonymous visitor. Nothing
 * here knows about Better Auth, cookies or Next.js, so domain code, tests
 * and scripts can depend on it without a request in flight. The server
 * binding that turns a session into a Viewer lives in lib/auth/session.ts.
 */

export const USER_ROLES = ["USER", "ADMIN"] as const
export type UserRole = (typeof USER_ROLES)[number]

export type Viewer = {
  /** MatchBase user id: the User row follows and the watchlist hang off. */
  id: string
  email: string
  name: string
  role: UserRole
}

export type AuthorizationFailure = "unauthenticated" | "forbidden"

/** Thrown by the guards. The message is safe to show; it names no internals. */
export class AuthorizationError extends Error {
  readonly kind: AuthorizationFailure
  constructor(kind: AuthorizationFailure) {
    super(kind === "unauthenticated" ? "Sign in to continue." : "You do not have permission to do this.")
    this.name = "AuthorizationError"
    this.kind = kind
  }
}

export function isAuthorizationError(error: unknown): error is AuthorizationError {
  return error instanceof AuthorizationError
}

/** A stored role value that is not one of ours is treated as the least privilege, never as admin. */
export function toUserRole(value: unknown): UserRole {
  return value === "ADMIN" ? "ADMIN" : "USER"
}

/**
 * Builds a Viewer from whatever the session layer returns. Only the four
 * fields cross the boundary, so provider-specific objects never reach
 * domain code, and an unexpected role collapses to USER.
 */
export function toViewer(user: { id: string; email: string; name?: string | null; role?: unknown }): Viewer {
  return { id: user.id, email: user.email, name: user.name?.trim() || user.email, role: toUserRole(user.role) }
}

export function isAdmin(viewer: Viewer | null): viewer is Viewer & { role: "ADMIN" } {
  return viewer !== null && viewer.role === "ADMIN"
}

/** The viewer, or an `unauthenticated` failure. */
export function assertUser(viewer: Viewer | null): Viewer {
  if (viewer === null) throw new AuthorizationError("unauthenticated")
  return viewer
}

/** The viewer as an administrator, or `unauthenticated` (no session) / `forbidden` (a USER). */
export function assertAdmin(viewer: Viewer | null): Viewer & { role: "ADMIN" } {
  const user = assertUser(viewer)
  if (!isAdmin(user)) throw new AuthorizationError("forbidden")
  return user
}
