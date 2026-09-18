import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { buildContentSecurityPolicy, cspForRequest, cspHeaderName, DEFAULT_IMAGE_HOSTS, resolveCspMode, resolveImageHosts } from "../../lib/http/csp"
import { HSTS_VALUE, securityHeaders } from "../../lib/http/security-headers"

/** The exact header baseline and Content Security Policy MatchBase sends. */

function directive(policy: string, name: string): string | undefined {
  return policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `) || part === name)
}

describe("securityHeaders", () => {
  it("sends the baseline on every response and HSTS only in production", () => {
    const production = Object.fromEntries(securityHeaders({ production: true }).map((h) => [h.key, h.value]))
    assert.equal(production["X-Content-Type-Options"], "nosniff")
    assert.equal(production["Referrer-Policy"], "strict-origin-when-cross-origin")
    assert.equal(production["X-Frame-Options"], "DENY")
    assert.match(production["Permissions-Policy"], /camera=\(\)/)
    assert.match(production["Permissions-Policy"], /geolocation=\(\)/)
    assert.equal(production["Strict-Transport-Security"], HSTS_VALUE)
    assert.doesNotMatch(HSTS_VALUE, /preload/, "preload is a conscious registry commitment, not a default")
    const development = securityHeaders({ production: false })
    assert.equal(development.some((h) => h.key === "Strict-Transport-Security"), false)
    assert.equal(development.length, 5)
  })
})

describe("Content Security Policy", () => {
  const nonce = "dGVzdC1ub25jZQ=="

  it("production: nonce plus strict-dynamic for scripts, no wildcards, no unsafe-eval", () => {
    const policy = buildContentSecurityPolicy({ nonce, environment: "production" })
    assert.equal(directive(policy, "default-src"), "default-src 'self'")
    assert.equal(directive(policy, "script-src"), `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`)
    assert.equal(directive(policy, "style-src"), "style-src 'self' 'unsafe-inline'")
    assert.equal(directive(policy, "img-src"), `img-src 'self' data: ${DEFAULT_IMAGE_HOSTS.join(" ")}`)
    assert.equal(directive(policy, "font-src"), "font-src 'self'")
    assert.equal(directive(policy, "connect-src"), "connect-src 'self'")
    assert.equal(directive(policy, "object-src"), "object-src 'none'")
    assert.equal(directive(policy, "base-uri"), "base-uri 'self'")
    assert.equal(directive(policy, "form-action"), "form-action 'self'")
    assert.equal(directive(policy, "frame-ancestors"), "frame-ancestors 'none'")
    assert.equal(directive(policy, "upgrade-insecure-requests"), "upgrade-insecure-requests")
    assert.doesNotMatch(policy, /\*/)
    assert.doesNotMatch(policy, /unsafe-eval/)
    assert.doesNotMatch(policy, /script-src[^;]*unsafe-inline/)
  })

  it("development adds only what the tooling needs", () => {
    const policy = buildContentSecurityPolicy({ nonce, environment: "development" })
    assert.match(directive(policy, "script-src") ?? "", /'unsafe-eval'$/)
    assert.equal(directive(policy, "connect-src"), "connect-src 'self' ws: wss:")
    assert.equal(directive(policy, "upgrade-insecure-requests"), undefined)
  })

  it("image hosts extend only with https origins", () => {
    assert.deepEqual(resolveImageHosts({}), [...DEFAULT_IMAGE_HOSTS])
    assert.deepEqual(resolveImageHosts({ CSP_IMAGE_HOSTS: "https://img.example, http://bad.example, javascript:alert(1), https://r2.thesportsdb.com" }), [...DEFAULT_IMAGE_HOSTS, "https://img.example"])
  })

  it("mode defaults to enforce and maps to the right header", () => {
    assert.equal(resolveCspMode({}), "enforce")
    assert.equal(resolveCspMode({ CSP_MODE: "Report-Only" }), "report-only")
    assert.equal(resolveCspMode({ CSP_MODE: "off" }), "off")
    assert.equal(resolveCspMode({ CSP_MODE: "nonsense" }), "enforce")
    assert.equal(cspHeaderName("enforce"), "Content-Security-Policy")
    assert.equal(cspHeaderName("report-only"), "Content-Security-Policy-Report-Only")
    assert.equal(cspHeaderName("off"), null)
    const request = cspForRequest({ VERCEL_ENV: "production", CSP_MODE: "report-only" }, nonce)
    assert.equal(request.header, "Content-Security-Policy-Report-Only")
    assert.match(request.value, new RegExp(`nonce-${nonce}`))
    assert.equal(cspForRequest({ CSP_MODE: "off" }, nonce).header, null)
  })
})
