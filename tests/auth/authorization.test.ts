import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { AuthorizationError, assertAdmin, assertUser, isAdmin, isAuthorizationError, toUserRole, toViewer, type Viewer } from "../../lib/auth/authorization"
import { safeNextPath, signInHref } from "../../lib/auth/redirect"

/**
 * The authorization matrix, on the pure guards every Server Action and
 * loader calls. Actors: anonymous (null), USER, ADMIN. The server binding
 * (lib/auth/session.ts) only turns a session into one of these values.
 */

const user: Viewer = { id: "u-1", email: "user@example.test", name: "User", role: "USER" }
const admin: Viewer = { id: "u-2", email: "admin@example.test", name: "Admin", role: "ADMIN" }

function failure(fn: () => unknown): AuthorizationError["kind"] | "allowed" {
  try {
    fn()
    return "allowed"
  } catch (error) {
    if (isAuthorizationError(error)) return error.kind
    throw error
  }
}

describe("requireUser matrix (assertUser)", () => {
  it("anonymous is unauthenticated", () => assert.equal(failure(() => assertUser(null)), "unauthenticated"))
  it("USER is allowed and returned unchanged", () => assert.deepEqual(assertUser(user), user))
  it("ADMIN is allowed", () => assert.deepEqual(assertUser(admin), admin))
})

describe("requireAdmin matrix (assertAdmin)", () => {
  it("anonymous is unauthenticated, not forbidden", () => assert.equal(failure(() => assertAdmin(null)), "unauthenticated"))
  it("USER is forbidden", () => assert.equal(failure(() => assertAdmin(user)), "forbidden"))
  it("ADMIN is allowed", () => assert.deepEqual(assertAdmin(admin), admin))
  it("isAdmin agrees", () => {
    assert.equal(isAdmin(null), false)
    assert.equal(isAdmin(user), false)
    assert.equal(isAdmin(admin), true)
  })
})

describe("AuthorizationError", () => {
  it("carries a message safe to show and no internals", () => {
    const e = new AuthorizationError("forbidden")
    assert.equal(e.name, "AuthorizationError")
    assert.match(e.message, /permission/)
    assert.doesNotMatch(e.message, /session|cookie|token|database|prisma/i)
    assert.equal(isAuthorizationError(new Error("forbidden")), false)
  })
})

describe("toViewer / toUserRole", () => {
  it("maps only the four fields and never invents admin", () => {
    const viewer = toViewer({ id: "x", email: "x@example.test", name: "  X  ", role: "USER", extra: "ignored" } as never)
    assert.deepEqual(viewer, { id: "x", email: "x@example.test", name: "X", role: "USER" })
  })
  it("falls back to the email as display name and to USER for unknown roles", () => {
    assert.equal(toViewer({ id: "x", email: "x@example.test", name: "" }).name, "x@example.test")
    assert.equal(toViewer({ id: "x", email: "x@example.test", name: null }).name, "x@example.test")
    for (const value of [undefined, null, "", "admin", "Admin", "SUPERADMIN", 1, true, {}]) assert.equal(toUserRole(value), "USER", String(value))
    assert.equal(toUserRole("ADMIN"), "ADMIN")
  })
})

describe("safeNextPath", () => {
  it("keeps same-origin paths", () => {
    assert.equal(safeNextPath("/watchlist"), "/watchlist")
    assert.equal(safeNextPath("/teams/lakers?tab=fixtures#top"), "/teams/lakers?tab=fixtures#top")
  })
  it("rejects open redirects and junk", () => {
    for (const bad of [undefined, null, 3, "", "https://evil.test", "//evil.test", "/\\evil.test", "/ok\nSet-Cookie: x", " /x", "/x y", "javascript:alert(1)", "/sign-in", "/sign-up?x", "/api/auth/sign-out", "/".padEnd(2001, "a")]) {
      assert.equal(safeNextPath(bad), "/dashboard", String(bad))
    }
  })
  it("signInHref encodes the destination and omits the default", () => {
    assert.equal(signInHref("/dashboard"), "/sign-in")
    assert.equal(signInHref(undefined), "/sign-in")
    assert.equal(signInHref("/teams/lakers?tab=1"), "/sign-in?next=%2Fteams%2Flakers%3Ftab%3D1")
    assert.equal(signInHref("https://evil.test"), "/sign-in")
  })
})
