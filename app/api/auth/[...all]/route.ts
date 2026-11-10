import { toNextJsHandler } from "better-auth/next-js"

import { getAuth } from "@/lib/auth/auth"
import { authPathOf, isBlockedAuthRequest } from "@/lib/auth/blocked-auth-paths"
import { withTrustedClientIp } from "@/lib/auth/client-ip"
import { verifyEmailToken } from "@/lib/auth/email-verification"

/**
 * Better Auth endpoints (sign-up, sign-in, sign-out, session), mounted where
 * the Next.js integration documents them. Node.js runtime: the handler
 * reads and writes PostgreSQL through the Prisma driver adapter.
 *
 * The handler is created on first request, not at module load: `next build`
 * evaluates route modules while collecting page data, and the auth
 * configuration is validated against the runtime environment, not the build's.
 *
 * GET endpoints that would carry a token in the URL are refused here
 * (lib/auth/blocked-auth-paths.ts) before Better Auth sees them, and
 * `POST /api/auth/verify-email` (token in the body) is bridged to Better
 * Auth's verification in-process.
 *
 * Every request is first given the client IP derived from the platform's own
 * headers (lib/auth/client-ip.ts); Better Auth's rate limiter reads only that,
 * never a forwarded header a client sent.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

let handler: ReturnType<typeof toNextJsHandler> | undefined

function handlers() {
  handler ??= toNextJsHandler(getAuth())
  return handler
}

const NOT_FOUND = () => new Response("Not Found", { status: 404, headers: { "cache-control": "no-store" } })

export async function GET(request: Request): Promise<Response> {
  const path = authPathOf(request.url)
  if (path && isBlockedAuthRequest("GET", path)) return NOT_FOUND()
  return handlers().GET(withTrustedClientIp(request, process.env))
}

export async function POST(incoming: Request): Promise<Response> {
  const request = withTrustedClientIp(incoming, process.env)
  if (authPathOf(request.url) === "/verify-email") {
    const result = await verifyEmailToken(request, (internal) => handlers().GET(internal))
    return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } })
  }
  return handlers().POST(request)
}
