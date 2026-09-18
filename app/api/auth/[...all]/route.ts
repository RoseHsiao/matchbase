import { toNextJsHandler } from "better-auth/next-js"

import { getAuth } from "@/lib/auth/auth"

/**
 * Better Auth endpoints (sign-up, sign-in, sign-out, session), mounted where
 * the Next.js integration documents them. Node.js runtime: the handler
 * reads and writes PostgreSQL through the Prisma driver adapter.
 *
 * The handler is created on first request, not at module load: `next build`
 * evaluates route modules while collecting page data, and the auth
 * configuration is validated against the runtime environment, not the build's.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

let handler: ReturnType<typeof toNextJsHandler> | undefined

function handlers() {
  handler ??= toNextJsHandler(getAuth())
  return handler
}

export async function GET(request: Request): Promise<Response> {
  return handlers().GET(request)
}

export async function POST(request: Request): Promise<Response> {
  return handlers().POST(request)
}
