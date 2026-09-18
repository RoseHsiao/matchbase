/**
 * Baseline response headers for every route, set from next.config.ts so
 * they reach pages, Route Handlers and static files alike. Kept as data so
 * the exact policy is unit-tested and documented from one place.
 *
 * Choices (verified against the Next.js headers reference and Vercel's
 * response-headers reference, 2026-09-18):
 * - X-Content-Type-Options: nosniff — the only valid value.
 * - Referrer-Policy: strict-origin-when-cross-origin — full referrer on the
 *   same origin, origin only to other https sites, nothing to http.
 * - Permissions-Policy: MatchBase uses no camera, microphone, geolocation,
 *   payment or USB APIs, and opts out of interest-cohort style features.
 * - X-Frame-Options: DENY — a fallback for the CSP `frame-ancestors 'none'`
 *   in lib/http/csp.ts for browsers that ignore CSP frame-ancestors.
 * - Strict-Transport-Security: Vercel already sends max-age=63072000 on
 *   every deployment; setting the same value here keeps a self-hosted
 *   Production equivalent. `preload` is deliberately omitted: it is a
 *   registry commitment the operator should make consciously. Sent only in
 *   production so local http development is unaffected.
 * - X-DNS-Prefetch-Control: off — the app links to no third-party origins
 *   that need early resolution.
 */

export type HeaderEntry = { key: string; value: string }

export const HSTS_VALUE = "max-age=63072000; includeSubDomains"

export function securityHeaders(options: { production: boolean }): HeaderEntry[] {
  const headers: HeaderEntry[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
  ]
  if (options.production) headers.push({ key: "Strict-Transport-Security", value: HSTS_VALUE })
  return headers
}
