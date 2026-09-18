import "server-only"

import { cache } from "react"
import { headers } from "next/headers"

import { getAuth } from "@/lib/auth/auth"
import { assertAdmin, assertUser, toViewer, type Viewer } from "@/lib/auth/authorization"

/**
 * The server-side identity boundary. Everything that needs to know who is
 * asking calls one of these three functions; nothing else reads cookies or
 * touches Better Auth.
 *
 * `getViewer` resolves the session cookie against the Session table on every
 * request (no cookie cache), memoised per request with React's `cache`, so a
 * page, its layout and the actions it triggers all see the same answer and
 * a revoked session or changed role is honoured on the very next request.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  // Request headers first: outside a request (a build-time prerender attempt)
  // this bails out before the auth configuration is even read.
  const requestHeaders = await headers()
  const session = await getAuth().api.getSession({ headers: requestHeaders })
  return session ? toViewer(session.user) : null
})

/** The signed-in viewer, or an AuthorizationError("unauthenticated"). */
export async function requireUser(): Promise<Viewer> {
  return assertUser(await getViewer())
}

/** The signed-in administrator, or AuthorizationError("unauthenticated" | "forbidden"). */
export async function requireAdmin(): Promise<Viewer & { role: "ADMIN" }> {
  return assertAdmin(await getViewer())
}
