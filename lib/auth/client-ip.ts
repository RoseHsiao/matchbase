import { isIP } from "node:net"

import type { EnvLike } from "@/lib/env/runtime-environment"

/**
 * The client IP the auth rate limiter keys on, decided at MatchBase's own
 * route boundary (app/api/auth/[...all]/route.ts) and handed to Better Auth
 * in one private header. Better Auth is configured to read only that header
 * (`advanced.ipAddress.ipAddressHeaders`, lib/auth/create-auth.ts), so a
 * forwarded header a client sends is never trusted by itself.
 *
 * Why here and not in Better Auth: Better Auth 1.7.5 trusts a forwarded header
 * only when it holds a single value, unless `trustedProxies` lists the proxy
 * addresses. Vercel publishes no fixed edge range to list. With a multi-value
 * header every request would fall into one shared per-path bucket ("no-trusted-ip"),
 * so a handful of sign-ups anywhere would lock sign-up for everybody. Its rate
 * limiter also runs before any plugin `onRequest` hook, so a plugin cannot
 * fix the IP either.
 *
 * Trust boundary:
 * - On Vercel (`VERCEL=1`, set by the platform at run time): `x-forwarded-for`.
 *   Vercel documents it as the client's public IP and says it overwrites the
 *   header to prevent spoofing. The rightmost valid entry is taken: if Vercel
 *   overwrote the header it is the only entry; if it ever appended to a
 *   client-supplied chain, the rightmost entry is the one Vercel added, and
 *   anything to its left is client-controlled and ignored. Then
 *   `x-vercel-forwarded-for` and `x-real-ip` (documented as identical), the
 *   same way. Whether Vercel ever sends a chain, and whether a client can
 *   preset the `x-vercel-*` header, is NOT confirmed locally; it is a Preview
 *   verification item (docs/security/production-hardening.md, "Rate-limit
 *   client IP").
 * - Anywhere else (local `next start`, a self-hosted server, tests): no
 *   header is trusted, because nothing vouches for it. The limiter then uses
 *   Better Auth's shared fallback bucket. That is strict, never permissive,
 *   and the limiter is off in development anyway. A self-hosted deployment
 *   would need its own proxy rule here.
 */

export const CLIENT_IP_HEADER = "x-matchbase-client-ip"

const VERCEL_IP_HEADERS = ["x-forwarded-for", "x-vercel-forwarded-for", "x-real-ip"] as const

function rightmostValidIp(value: string | null): string | null {
  if (!value) return null
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean)
  const last = entries.at(-1)
  // Only the rightmost entry can come from the platform; if it is not an address, nothing to its left is trusted instead.
  return last && isIP(last) ? last : null
}

/** The client IP to rate-limit on, or null when no trusted source exists. Pure; unit-tested. */
export function resolveClientIp(headers: Headers, env: EnvLike): string | null {
  if (env.VERCEL !== "1") return null
  for (const name of VERCEL_IP_HEADERS) {
    const ip = rightmostValidIp(headers.get(name))
    if (ip) return ip
  }
  return null
}

/**
 * The request Better Auth sees: any client-supplied CLIENT_IP_HEADER is
 * removed, and the trusted value is set when one exists. Everything else,
 * including the body, is passed through unchanged.
 */
export function withTrustedClientIp(request: Request, env: EnvLike): Request {
  const headers = new Headers(request.headers)
  headers.delete(CLIENT_IP_HEADER)
  const ip = resolveClientIp(request.headers, env)
  if (ip) headers.set(CLIENT_IP_HEADER, ip)
  return new Request(request, { headers })
}
