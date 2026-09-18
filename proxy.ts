import { NextResponse, type NextRequest } from "next/server"

import { cspForRequest } from "@/lib/http/csp"

/**
 * Per-request Content Security Policy with a fresh nonce, as the Next.js
 * CSP guide describes: the nonce travels to the renderer in the request
 * headers (`x-nonce` and the policy itself, which Next.js parses to attach
 * the nonce to its own scripts) and the policy is sent on the response.
 * The mode (enforce, report-only, off) comes from lib/http/csp.ts.
 *
 * This file does no authentication: sessions are verified in pages and
 * actions (docs/security/authentication-and-authorization.md).
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64")
  const { header, value } = cspForRequest(process.env, nonce)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-nonce", nonce)
  if (header) requestHeaders.set("Content-Security-Policy", value)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  if (header) response.headers.set(header, value)
  return response
}

export const config = {
  matcher: [
    {
      // Pages only: the auth and cron Route Handlers, static chunks, image optimisation and the favicon carry no HTML.
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
}
