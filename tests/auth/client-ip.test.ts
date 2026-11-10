import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"

import { CLIENT_IP_HEADER, resolveClientIp, withTrustedClientIp } from "../../lib/auth/client-ip"

const VERCEL = { VERCEL: "1" }
const headers = (values: Record<string, string>) => new Headers(values)

describe("resolveClientIp: which forwarded value the auth rate limiter may trust", () => {
  it("on Vercel takes the rightmost x-forwarded-for entry, the one the platform observed", () => {
    assert.equal(resolveClientIp(headers({ "x-forwarded-for": "203.0.113.7" }), VERCEL), "203.0.113.7")
    assert.equal(resolveClientIp(headers({ "x-forwarded-for": "198.18.0.1, 203.0.113.7" }), VERCEL), "203.0.113.7", "a client-forged left part is ignored")
    assert.equal(resolveClientIp(headers({ "x-forwarded-for": "1.1.1.1,2.2.2.2 , 2001:db8::5" }), VERCEL), "2001:db8::5")
  })

  it("two clients behind the same forged chain get different addresses, never a shared value", () => {
    const a = resolveClientIp(headers({ "x-forwarded-for": "198.18.0.1, 203.0.113.10" }), VERCEL)
    const b = resolveClientIp(headers({ "x-forwarded-for": "198.18.0.1, 203.0.113.11" }), VERCEL)
    assert.notEqual(a, b)
  })

  it("an invalid rightmost entry is not replaced by a client-controlled one to its left; the next platform header is used", () => {
    assert.equal(resolveClientIp(headers({ "x-forwarded-for": "203.0.113.7, not-an-ip" }), VERCEL), null)
    assert.equal(resolveClientIp(headers({ "x-forwarded-for": "203.0.113.7, unknown", "x-vercel-forwarded-for": "203.0.113.8" }), VERCEL), "203.0.113.8")
    assert.equal(resolveClientIp(headers({ "x-forwarded-for": "", "x-real-ip": "203.0.113.9" }), VERCEL), "203.0.113.9")
    assert.equal(resolveClientIp(headers({ "x-forwarded-for": "203.0.113.7:443" }), VERCEL), null, "a port is not an address")
  })

  it("off Vercel nothing vouches for a forwarded header, so none is trusted", () => {
    for (const env of [{}, { VERCEL: "0" }, { VERCEL_ENV: "production" }, { NODE_ENV: "production" }]) {
      assert.equal(resolveClientIp(headers({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "203.0.113.7" }), env), null, JSON.stringify(env))
    }
  })

  it("the private header a client sends is always replaced or removed, and the body survives", async () => {
    const forged = () => new Request("https://matchbase.example/api/auth/sign-in/email", { method: "POST", headers: { [CLIENT_IP_HEADER]: "198.18.0.2", "x-forwarded-for": "198.18.0.1, 203.0.113.7", "content-type": "application/json" }, body: JSON.stringify({ a: 1 }) })
    const onVercel = withTrustedClientIp(forged(), VERCEL)
    assert.equal(onVercel.headers.get(CLIENT_IP_HEADER), "203.0.113.7")
    assert.deepEqual(await onVercel.json(), { a: 1 })
    const elsewhere = withTrustedClientIp(forged(), {})
    assert.equal(elsewhere.headers.get(CLIENT_IP_HEADER), null)
    assert.equal(elsewhere.headers.get("x-forwarded-for"), "198.18.0.1, 203.0.113.7", "other headers pass through untouched")
  })
})

describe("wiring", () => {
  it("Better Auth reads only the private header, and the auth route sets it on every request", () => {
    assert.match(readFileSync("lib/auth/create-auth.ts", "utf8"), /ipAddress: \{ ipAddressHeaders: \[CLIENT_IP_HEADER\] \}/)
    const route = readFileSync("app/api/auth/[...all]/route.ts", "utf8")
    assert.match(route, /handlers\(\)\.GET\(withTrustedClientIp\(request, process\.env\)\)/)
    assert.match(route, /const request = withTrustedClientIp\(incoming, process\.env\)/)
    assert.doesNotMatch(route, /handlers\(\)\.(GET|POST)\(incoming\)/)
    assert.doesNotMatch(readFileSync("lib/auth/create-auth.ts", "utf8"), /trustedProxies/, "no broad proxy range is trusted")
  })
})
