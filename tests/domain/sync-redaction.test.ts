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
