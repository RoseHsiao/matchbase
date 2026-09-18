import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { describeErrorForOperator, logServerError } from "../../lib/logging/server-log"

const env = { DATABASE_URL: "postgresql://app:db-pass-word@host/neondb", BETTER_AUTH_SECRET: "auth-secret-value-0123456789abcdef", THESPORTSDB_API_KEY: "sekret-key-42" }

describe("describeErrorForOperator", () => {
  it("names the error class and redacts secrets from the message", () => {
    const error = new Error(`connect failed for postgresql://app:db-pass-word@host/neondb with key sekret-key-42 and Authorization: Bearer abc.def.ghi`)
    const line = describeErrorForOperator(error, env)
    assert.match(line, /^Error: /)
    for (const secret of ["db-pass-word", "sekret-key-42", "abc.def.ghi"]) assert.equal(line.includes(secret), false, secret)
  })
  it("handles non-Error values and clips long messages", () => {
    assert.equal(describeErrorForOperator("plain string", env), "string: plain string")
    assert.equal(describeErrorForOperator({ code: 1 }, env), 'object: {"code":1}')
    assert.equal(describeErrorForOperator(new Error(""), env), "Error: (no message)")
    assert.ok(describeErrorForOperator(new Error("x".repeat(2000)), env).length < 700)
  })
})

describe("logServerError", () => {
  function capture(work: () => void): string[] {
    const lines: string[] = []
    const original = console.error
    console.error = (...args: unknown[]) => lines.push(args.map(String).join(" "))
    try {
      work()
    } finally {
      console.error = original
    }
    return lines
  }
  it("prints one redacted line in production, no stack", () => {
    const lines = capture(() => logServerError("admin-sync", new Error("boom with auth-secret-value-0123456789abcdef"), { ...env, VERCEL_ENV: "production" }))
    assert.equal(lines.length, 1)
    assert.match(lines[0], /^\[admin-sync\] Error: boom with /)
    assert.equal(lines[0].includes("auth-secret-value"), false)
    assert.equal(lines[0].includes("    at "), false)
  })
  it("adds a redacted stack outside production", () => {
    const lines = capture(() => logServerError("x", new Error("dev boom"), env))
    assert.equal(lines.length, 1)
    assert.match(lines[0], /dev boom/)
    assert.match(lines[0], /at /)
  })
})
