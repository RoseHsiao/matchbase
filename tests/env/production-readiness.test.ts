import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { blockingChecks, evaluateProductionReadiness } from "../../lib/env/production-config"

/**
 * The readiness evaluation that backs `npm run production:check` and the
 * startup guard. Every detail line is checked to contain no secret value.
 */

const SECRET = "Qm9a7x3fKp2LwZ8vN4cR1tY6uH0sJ5eD9gB3nM7kV1a="
const CRON = "cron-9f8e7d6c5b4a3f2e1d0c"
const DB = "postgresql://matchbase_app:runtime-pass-word@ep-abc-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full"
const DB_DIRECT = "postgresql://neondb_owner:owner-pass-word@ep-abc.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full"

const production = {
  VERCEL: "1",
  VERCEL_ENV: "production",
  VERCEL_PROJECT_PRODUCTION_URL: "matchbase.example",
  MATCHBASE_DATABASE_LABEL: "production",
  DATABASE_URL: DB,
  DATABASE_URL_UNPOOLED: DB_DIRECT,
  BETTER_AUTH_SECRET: SECRET,
  CRON_SECRET: CRON,
}

function ids(checks: { id: string }[]): string[] {
  return checks.map((check) => check.id).sort()
}

describe("evaluateProductionReadiness", () => {
  it("a complete Production configuration is ready", () => {
    const report = evaluateProductionReadiness(production)
    assert.deepEqual(ids(report.failures), [])
    assert.equal(report.environment, "production")
    assert.equal(report.platform, "vercel")
    assert.equal(report.checks.find((c) => c.id === "sign-up")?.status, "pass")
    assert.equal(report.checks.find((c) => c.id === "csp")?.status, "pass")
    assert.equal(report.checks.find((c) => c.id === "provider:ds-thesportsdb-epl")?.status, "pass", "the public free key configures TheSportsDB")
  })

  it("never prints a secret or a connection string", () => {
    const report = evaluateProductionReadiness(production)
    const text = JSON.stringify(report)
    for (const value of [SECRET, CRON, "runtime-pass-word", "owner-pass-word", "postgresql://"]) assert.equal(text.includes(value), false, value)
  })

  it("fails Production on each missing or weak security-critical value", () => {
    const cases: [Partial<Record<string, string | undefined>>, string][] = [
      [{ MATCHBASE_DATABASE_LABEL: undefined }, "database-label"],
      [{ MATCHBASE_DATABASE_LABEL: "preview" }, "database-label"],
      [{ DATABASE_URL: undefined }, "database-url"],
      [{ DATABASE_URL: DB.replace("verify-full", "require") }, "database-url"],
      [{ BETTER_AUTH_SECRET: "short" }, "auth-secret"],
      [{ BETTER_AUTH_SECRET: "a".repeat(40) }, "auth-secret"],
      [{ VERCEL_PROJECT_PRODUCTION_URL: undefined }, "auth-url"],
      [{ BETTER_AUTH_URL: "http://matchbase.example" }, "auth-url"],
      [{ CRON_SECRET: undefined }, "cron-secret"],
      [{ CRON_SECRET: "short" }, "cron-secret"],
      [{ CRON_SECRET: SECRET }, "secret-separation"],
      [{ MATCHBASE_DEV_LOGIN: "true" }, "dev-login"],
      [{ MATCHBASE_DEV_ADMIN_PASSWORD: "dev-admin-password-1" }, "dev-login"],
      [{ ALLOW_PRODUCTION_SEED: "true" }, "seed"],
      [{ CSP_MODE: "off" }, "csp"],
      [{ CSP_MODE: "sometimes" }, "csp"],
      [{ SYNC_EXPECTED_INTERVAL_MINUTES: "abc" }, "sync-cadence"],
    ]
    for (const [override, expected] of cases) {
      const report = evaluateProductionReadiness({ ...production, ...override })
      assert.ok(report.failures.some((check) => check.id === expected), `${JSON.stringify(override)} should fail ${expected}; failures: ${ids(report.failures).join(",")}`)
      assert.ok(blockingChecks(report).some((check) => check.id === expected), `${expected} blocks Production`)
    }
  })

  it("warns, rather than fails, on open sign-up, identical database roles and report-only CSP", () => {
    const report = evaluateProductionReadiness({ ...production, AUTH_ALLOW_SIGN_UP: "true", DATABASE_URL_UNPOOLED: DB, CSP_MODE: "report-only" })
    assert.deepEqual(ids(report.failures), [])
    assert.deepEqual(ids(report.warnings), ["csp", "database-roles", "sign-up"])
    assert.match(report.warnings.find((c) => c.id === "sign-up")?.detail ?? "", /cannot verify or recover/)
  })

  it("Preview blocks only what could reach Production", () => {
    const preview = { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "matchbase-git-x.vercel.app", MATCHBASE_DATABASE_LABEL: "preview", DATABASE_URL: DB, DATABASE_URL_UNPOOLED: DB_DIRECT, BETTER_AUTH_SECRET: SECRET }
    const clean = evaluateProductionReadiness(preview)
    assert.deepEqual(blockingChecks(clean), [])
    assert.equal(clean.checks.find((c) => c.id === "cron-secret")?.status, "pass", "no cron secret on preview is the intended state")
    assert.equal(clean.checks.find((c) => c.id === "preview-sync")?.status, "pass")
    const dangerous = evaluateProductionReadiness({ ...preview, MATCHBASE_DATABASE_LABEL: "production", MATCHBASE_DEV_LOGIN: "true", CRON_SECRET: CRON })
    assert.deepEqual(ids(blockingChecks(dangerous)), ["database-label", "dev-login"])
    assert.equal(dangerous.checks.find((c) => c.id === "cron-secret")?.status, "warn")
    // A weak auth secret is a failure the report shows, but Preview does not refuse to start for it.
    const weak = evaluateProductionReadiness({ ...preview, BETTER_AUTH_SECRET: "short" })
    assert.ok(weak.failures.some((c) => c.id === "auth-secret"))
    assert.deepEqual(blockingChecks(weak), [])
  })

  it("development never blocks and reports the dev-only features as information", () => {
    const report = evaluateProductionReadiness({ DATABASE_URL: DB, DATABASE_URL_UNPOOLED: DB_DIRECT, BETTER_AUTH_SECRET: SECRET, MATCHBASE_DEV_LOGIN: "true", MATCHBASE_DATABASE_LABEL: "development" })
    assert.deepEqual(blockingChecks(report), [])
    assert.equal(report.checks.find((c) => c.id === "dev-login")?.status, "pass")
    assert.equal(report.checks.find((c) => c.id === "sign-up")?.status, "info")
  })
})
