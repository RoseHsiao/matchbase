import { isFlagEnabled, resolveRuntimeEnvironment, type EnvLike, type RuntimeEnvironment } from "@/lib/env/runtime-environment"

/**
 * Content Security Policy, built per request with a nonce (proxy.ts) as the
 * Next.js CSP guide recommends. Every MatchBase page is dynamically
 * rendered already (session lookup), so nonces cost nothing extra.
 *
 * The policy is derived from the resources the application actually loads
 * (inventory in docs/security/production-hardening.md):
 * - scripts: Next.js and React chunks from this origin, plus the inline
 *   bootstrap scripts Next.js and next-themes emit; all carry the nonce,
 *   and 'strict-dynamic' lets nonce'd framework scripts load their chunks.
 *   'unsafe-eval' is added only in development, where React rebuilds
 *   server stacks with eval.
 * - styles: Tailwind's compiled stylesheet from this origin, and inline
 *   style attributes (team colours, sidebar geometry, Base UI positioning),
 *   which nonces cannot cover, hence 'unsafe-inline' for styles only.
 * - images: this origin (sport icons, favicon), data: for the avatar
 *   fallbacks, and the provider badge hosts that hold team logos.
 * - fonts: self-hosted by next/font.
 * - connect: this origin only (auth endpoints, Server Actions, RSC
 *   payloads); the websocket for hot reload in development.
 * - no frames, no objects, no plugins, no other origins.
 */

export type CspMode = "enforce" | "report-only" | "off"

export const CSP_MODE_VARIABLE = "CSP_MODE"

/** Hosts that serve team badges today; extend with CSP_IMAGE_HOSTS (comma separated) for a new provider. */
export const DEFAULT_IMAGE_HOSTS = ["https://r2.thesportsdb.com", "https://www.thesportsdb.com"] as const

export function resolveCspMode(env: EnvLike): CspMode {
  const value = env[CSP_MODE_VARIABLE]?.trim().toLowerCase()
  if (value === "enforce" || value === "report-only" || value === "off") return value
  return "enforce"
}

export function resolveImageHosts(env: EnvLike): string[] {
  const extra = (env.CSP_IMAGE_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter((host) => /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(host))
  return [...new Set([...DEFAULT_IMAGE_HOSTS, ...extra])]
}

export type CspInput = {
  nonce: string
  environment: RuntimeEnvironment
  imageHosts?: readonly string[]
}

export function buildContentSecurityPolicy({ nonce, environment, imageHosts = DEFAULT_IMAGE_HOSTS }: CspInput): string {
  const development = environment === "development"
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: ${imageHosts.join(" ")}`,
    `font-src 'self'`,
    `connect-src 'self'${development ? " ws: wss:" : ""}`,
    `worker-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ]
  if (!development) directives.push("upgrade-insecure-requests")
  return directives.join("; ")
}

export const CSP_HEADER = "Content-Security-Policy"
export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only"

export function cspHeaderName(mode: CspMode): string | null {
  if (mode === "enforce") return CSP_HEADER
  if (mode === "report-only") return CSP_REPORT_ONLY_HEADER
  return null
}

/** Everything proxy.ts needs for one request, from the environment. */
export function cspForRequest(env: EnvLike, nonce: string): { header: string | null; value: string } {
  const mode = resolveCspMode(env)
  const value = buildContentSecurityPolicy({ nonce, environment: resolveRuntimeEnvironment(env), imageHosts: resolveImageHosts(env) })
  return { header: cspHeaderName(mode), value }
}

/** Kept for readiness checks: a policy is only useful if it is on. */
export function isCspActive(env: EnvLike): boolean {
  return resolveCspMode(env) !== "off" && !isFlagEnabled(env.CSP_DISABLED)
}
