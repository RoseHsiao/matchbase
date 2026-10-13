import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { redactSensitiveText, secretValuesFrom } from "../../lib/data/sync/redaction"

const env = {
  CRON_SECRET: "cron-s3cret-value-9876",
  SPORTRADAR_API_KEY: "sr-key-ABCDEF123456",
  THESPORTSDB_API_KEY: "123",
  DATABASE_URL: "postgresql://neondb_owner:npg_pa55w0rd@ep-x.aws.neon.tech/neondb?sslmode=verify-full",
  NEXT_PUBLIC_SITE: "https://matchbase.example",
  PATH: "/usr/bin",
}

describe("secretValuesFrom", () => {
  test("collects secret-like variables and connection-string passwords, ignoring public values", () => {
    const values = secretValuesFrom(env)
    assert.ok(values.includes("cron-s3cret-value-9876"))
    assert.ok(values.includes("sr-key-ABCDEF123456"))
    assert.ok(values.includes("npg_pa55w0rd"), "password inside DATABASE_URL")
    assert.ok(values.some((v) => v.startsWith("postgresql://")), "the whole connection string too")
    assert.ok(!values.includes("123"), "the documented public TheSportsDB key is not a secret")
    assert.ok(!values.includes("/usr/bin"))
    assert.ok(!values.includes("https://matchbase.example"))
  })
})

describe("redactSensitiveText", () => {
  test("provider API key from the environment is removed wherever it appears", () => {
    const out = redactSensitiveText("HTTP 403 from https://api.sportradar.com/tennis/trial/v3/en/competitions.json?api_key=sr-key-ABCDEF123456 (key sr-key-ABCDEF123456)", env)
    assert.ok(!out.includes("sr-key-ABCDEF123456"))
    assert.match(out, /api_key=REDACTED|\[REDACTED\]/)
  })

  test("CRON_SECRET and Authorization values are removed", () => {
    const out = redactSensitiveText(`request failed; headers: authorization: Bearer cron-s3cret-value-9876, x-api-key: abc123456789`, env)
    assert.ok(!out.includes("cron-s3cret-value-9876"))
    assert.ok(!out.includes("abc123456789"))
    assert.match(out, /authorization: Bearer \[REDACTED\]/i)
  })

  test("a bearer token never seen in the environment is still masked", () => {
    const out = redactSensitiveText("Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig was rejected", {})
    assert.equal(out, "Bearer [REDACTED] was rejected")
  })

  test("database URLs lose their password, also when the exact string is not in the environment", () => {
    assert.equal(redactSensitiveText("connect ECONNREFUSED postgres://app:hunter22@db.internal:5432/matchbase", {}), "connect ECONNREFUSED postgres://app:[REDACTED]@db.internal:5432/matchbase")
    const out = redactSensitiveText(`could not connect to ${env.DATABASE_URL}`, env)
    assert.ok(!out.includes("npg_pa55w0rd"))
  })

  test("key-like query parameters in any URL are masked", () => {
    const out = redactSensitiveText("GET https://provider.test/feed?token=zzz-secret&team=arsenal failed", {})
    assert.ok(!out.includes("zzz-secret"))
    assert.ok(out.includes("team=arsenal"))
  })

  test("ordinary operational text is untouched", () => {
    const text = "ERROR match 5009: Team 999 was not synced.\nWARNING match 5008: Unmapped provider status \"PPD\"; existing status kept."
    assert.equal(redactSensitiveText(text, env), text)
    assert.equal(redactSensitiveText("Abandoned: the run did not finish within 15 minutes and was marked failed by a later run.", env), "Abandoned: the run did not finish within 15 minutes and was marked failed by a later run.")
  })

  test("the public free key 123 inside a TheSportsDB path is not mangled", () => {
    const text = "HTTP 500 from https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=2026-09-19&l=4328"
    assert.equal(redactSensitiveText(text, env), text)
  })
})

describe("redactSensitiveText: account-recovery values (Phase 10 fallback)", () => {
  test("a token in a URL fragment is masked; the rest of the URL survives", () => {
    const out = redactSensitiveText("link was https://matchbase.example/reset-password#token=AbC123xyz_-987654 opened", {})
    assert.ok(!out.includes("AbC123xyz_-987654"))
    assert.match(out, /https:\/\/matchbase\.example\/reset-password#token=\[REDACTED\] opened/)
  })

  test("a token in a query string, also outside a full URL, is masked", () => {
    for (const text of ["GET /api/auth/verify-email?token=eyJhbGciOi.payload.sig&callbackURL=/", "callback ?foo=1&token=Zz9Zz9Zz9Zz9 failed"]) {
      const out = redactSensitiveText(text, {})
      assert.ok(!out.includes("eyJhbGciOi") && !out.includes("Zz9Zz9Zz9Zz9"), out)
    }
    assert.ok(redactSensitiveText("callbackURL=/ kept", {}).includes("callbackURL=/ kept"))
  })

  test("Better Auth's reset link path and verification identifier are masked", () => {
    const path = redactSensitiveText("GET /api/auth/reset-password/q8Zr2Kd9LmN4pX7wT1vB3cYh?callbackURL=%2Freset 302", {})
    assert.equal(path, "GET /api/auth/reset-password/[REDACTED]?callbackURL=%2Freset 302")
    const identifier = redactSensitiveText(`duplicate key (identifier)=(reset-password:q8Zr2Kd9LmN4pX7wT1vB3cYh) already exists`, {})
    assert.equal(identifier, "duplicate key (identifier)=(reset-password:[REDACTED]) already exists")
    assert.equal(redactSensitiveText("reset-password:[REDACTED]", {}), "reset-password:[REDACTED]", "idempotent")
  })

  test("a Resend API key is masked from the environment and by its prefix", () => {
    const key = "re_AbCdEf123456_GhIjKl789012"
    assert.ok(secretValuesFrom({ RESEND_API_KEY: key }).includes(key))
    assert.ok(!redactSensitiveText(`auth failed with ${key}`, { RESEND_API_KEY: key }).includes(key))
    assert.ok(!redactSensitiveText(`auth failed with ${key}`, {}).includes(key), "even when the key is not in this environment")
  })

  test("ordinary words and routes that merely mention reset are untouched", () => {
    for (const text of ["Open /reset-password to choose a new password.", "Reset Password: User not found", "re_run the sync", "the token expired"]) {
      assert.equal(redactSensitiveText(text, {}), text)
    }
  })
})
