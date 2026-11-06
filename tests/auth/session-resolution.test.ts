import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { describe, it } from "node:test"

import { isAuthorizationError, resolveViewer, SessionResolutionError } from "../../lib/auth/authorization"
import { createAuth } from "../../lib/auth/create-auth"
import type { PrismaClient } from "../../lib/generated/prisma/client"

/**
 * The three outcomes of asking who is viewing, on the real Better Auth
 * configuration. Its database fails every call, so a session that needs the
 * database can only end in a failure, which must never read as anonymous.
 */

const SECRET = "session-resolution-test-secret-0123456789"
const COOKIE = "better-auth.session_token"

function failingDatabase() {
  const calls = { count: 0 }
  const fail = async () => {
    calls.count += 1
    throw new Error("connect ECONNREFUSED 127.0.0.1:1")
  }
  const prisma = new Proxy({}, {
    get: (_target, property) => (typeof property === "string" && property.startsWith("$") ? fail : new Proxy({}, { get: () => fail })),
  }) as unknown as PrismaClient
  return { prisma, calls }
}

function signed(value: string): string {
  return encodeURIComponent(`${value}.${createHmac("sha256", SECRET).update(value).digest("base64")}`)
}

async function viewerFor(cookie: string | null) {
  const { prisma, calls } = failingDatabase()
  const auth = createAuth({ prisma, env: { BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: "http://localhost:3000", VERCEL_ENV: "development" } })
  const failures: unknown[] = []
  const quiet = console.error
  console.error = () => {}
  try {
    const result = await resolveViewer(() => auth.api.getSession({ headers: new Headers(cookie ? { cookie } : {}) }), (error) => failures.push(error))
      .then((viewer) => ({ viewer }), (error: unknown) => ({ error }))
    return { ...result, calls: calls.count, failures }
  } finally {
    console.error = quiet
  }
}

describe("resolveViewer", () => {
  it("a session is the authenticated viewer", async () => {
    const viewer = await resolveViewer(async () => ({ user: { id: "u-1", email: "user@example.test", name: "User", role: "ADMIN" } }))
    assert.deepEqual(viewer, { id: "u-1", email: "user@example.test", name: "User", role: "ADMIN" })
  })

  it("no session is anonymous", async () => {
    assert.equal(await resolveViewer(async () => null), null)
  })

  it("a failure is neither: it rejects and reports the cause", async () => {
    const cause = new Error("connect ECONNREFUSED postgres://secret@host")
    const reported: unknown[] = []
    await assert.rejects(resolveViewer(async () => { throw cause }, (error) => reported.push(error)), (error: unknown) => {
      assert.ok(error instanceof SessionResolutionError)
      assert.doesNotMatch((error as Error).message, /ECONNREFUSED|postgres|secret/, "the message shown to a visitor names no internals")
      return true
    })
    assert.deepEqual(reported, [cause])
  })

  it("an unusable session is a failure too, not anonymous", async () => {
    await assert.rejects(resolveViewer(async () => ({ user: undefined as never })), SessionResolutionError)
  })

  it("a failure cannot be mistaken for not being signed in", () => {
    assert.equal(isAuthorizationError(new SessionResolutionError()), false)
  })
})

describe("the real auth configuration with its database down", () => {
  it("no cookie is anonymous, without touching the database", async () => {
    const result = await viewerFor(null)
    assert.equal("viewer" in result && result.viewer, null)
    assert.equal(result.calls, 0)
  })

  it("a cookie with a bad signature is anonymous, without touching the database", async () => {
    const result = await viewerFor(`${COOKIE}=forged.bad-signature`)
    assert.equal("viewer" in result && result.viewer, null)
    assert.equal(result.calls, 0)
  })

  it("a correctly signed session is a failure, never anonymous", async () => {
    const result = await viewerFor(`${COOKIE}=${signed("a-session-token")}`)
    assert.ok("error" in result && result.error instanceof SessionResolutionError, "must reject, not fall back to the demo")
    assert.ok(result.calls > 0, "the database was asked")
    assert.equal(result.failures.length, 1)
  })

  it("a missing auth secret is a failure, not anonymous", async () => {
    const { prisma } = failingDatabase()
    await assert.rejects(resolveViewer(async () => createAuth({ prisma, env: { VERCEL_ENV: "production" } }).api.getSession({ headers: new Headers() })), SessionResolutionError)
  })
})
